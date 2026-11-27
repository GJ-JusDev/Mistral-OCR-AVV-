import * as XLSX from "xlsx";

export interface ExtractedExcelSheet {
  sheetName: string;
  name: string;
  matrix: string[][];
  rowCount: number;
  columnCount: number;
  reconstructedRows: string[];
  rawText: string;
}

export interface ExtractedExcelDocument {
  sheets: ExtractedExcelSheet[];
  allReconstructedRows: string[];
  fullRawText: string;
  tables: Array<{
    rowCount: number;
    columnCount: number;
    cells: Array<{ rowIndex: number; columnIndex: number; content: string }>;
  }>;
}

/**
 * Checks if a filename, data URL, or MIME type indicates an Excel (.xlsx, .xls) or CSV document.
 */
export function isExcelOrCsvMimeOrExt(filenameOrMime?: string | null): boolean {
  if (!filenameOrMime || typeof filenameOrMime !== "string") return false;
  const lower = filenameOrMime.toLowerCase().trim();
  return (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    lower.includes("spreadsheetml") ||
    lower.includes("ms-excel") ||
    lower.includes("text/csv") ||
    lower.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ||
    lower.includes("application/vnd.ms-excel") ||
    lower.includes("text/csv") ||
    lower.startsWith("data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") ||
    lower.startsWith("data:application/vnd.ms-excel") ||
    lower.startsWith("data:text/csv")
  );
}

/**
 * Extracts all worksheets from an Excel (.xlsx, .xls) or CSV binary buffer.
 * Produces:
 * - 2D string matrices (`rows: string[][]`)
 * - " | "-delimited reconstructed text rows
 * - Pseudo Azure layout `tables` for cross-compatibility with Azure table parsers
 */
export function extractExcelDocument(buffer: Buffer): ExtractedExcelDocument {
  // Read workbook using SheetJS with cell date formatting enabled
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    raw: false,
  });

  const sheets: ExtractedExcelSheet[] = [];
  const allReconstructedRows: string[] = [];
  const fullTextParts: string[] = [];
  const tables: ExtractedExcelDocument["tables"] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convert sheet to 2D array of strings
    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    const matrix: string[][] = [];
    const sheetRows: string[] = [];
    const tableCells: Array<{ rowIndex: number; columnIndex: number; content: string }> = [];

    let activeRowIndex = 0;
    for (let r = 0; r < rawRows.length; r++) {
      const rawRow = rawRows[r] || [];
      const rowStrings = rawRow.map((cell: any) => {
        if (cell === undefined || cell === null) return "";
        return String(cell).replace(/[\r\n]+/g, " ").trim();
      });

      // Filter completely empty trailing cells
      while (rowStrings.length > 0 && rowStrings[rowStrings.length - 1] === "") {
        rowStrings.pop();
      }

      if (rowStrings.length === 0) continue;

      matrix.push(rowStrings);

      // Record non-empty cells for the pseudo Azure table
      for (let c = 0; c < rowStrings.length; c++) {
        const val = rowStrings[c];
        if (val) {
          tableCells.push({
            rowIndex: activeRowIndex,
            columnIndex: c,
            content: val,
          });
        }
      }

      // Format as " | "-delimited reconstructed row
      const delimited = rowStrings.join(" | ");
      sheetRows.push(delimited);
      allReconstructedRows.push(delimited);
      activeRowIndex++;
    }

    const maxCols = matrix.reduce((max, r) => Math.max(max, r.length), 0);
    const sheetRawText = sheetRows.join("\n");
    fullTextParts.push(`=== SHEET: ${sheetName} ===\n${sheetRawText}`);

    sheets.push({
      sheetName,
      name: sheetName,
      matrix,
      rowCount: matrix.length,
      columnCount: maxCols,
      reconstructedRows: sheetRows,
      rawText: sheetRawText,
    });

    if (tableCells.length > 0) {
      tables.push({
        rowCount: matrix.length,
        columnCount: maxCols,
        cells: tableCells,
      });
    }
  }

  const fullRawText = fullTextParts.join("\n\n");

  return {
    sheets,
    allReconstructedRows,
    fullRawText,
    tables,
  };
}
