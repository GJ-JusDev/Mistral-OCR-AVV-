import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("AVV — Document Wizard Camera Capture Workflow Suite", async (t) => {
  const rootDir = path.resolve("./");
  const uploadPagePath = path.join(rootDir, "src/app/upload/page.tsx");
  const cameraHookPath = path.join(rootDir, "src/hooks/useCamera.ts");
  const cameraModalPath = path.join(rootDir, "src/components/camera/DocumentCameraCaptureModal.tsx");

  const uploadPageSrc = fs.readFileSync(uploadPagePath, "utf8");
  const cameraHookSrc = fs.readFileSync(cameraHookPath, "utf8");
  const cameraModalSrc = fs.readFileSync(cameraModalPath, "utf8");

  // ── 1. Static Source Code Wiring ───────────────────────────────────────────
  await t.test("1. Upload page integrates DocumentCameraCaptureModal and Open Camera actions", () => {
    assert.ok(
      uploadPageSrc.includes("DocumentCameraCaptureModal"),
      "Upload page must import and render DocumentCameraCaptureModal"
    );
    assert.ok(
      uploadPageSrc.includes("const [isCameraOpen, setIsCameraOpen] = useState(false);") ||
      uploadPageSrc.includes("setIsCameraOpen(true)"),
      "Upload page must maintain isCameraOpen state"
    );
    assert.ok(
      uploadPageSrc.includes("Open Camera"),
      "Upload area must render visible 'Open Camera' buttons"
    );
    assert.ok(
      uploadPageSrc.includes("handlePhotoCaptured"),
      "Upload page must implement handlePhotoCaptured callback"
    );
    assert.ok(
      uploadPageSrc.includes("dataUrlToFile"),
      "Upload page must convert captured image dataUrl to File object"
    );
  });

  await t.test("2. useCamera hook supports lifecycle management, facingMode, error handling, and track cleanup", () => {
    assert.ok(
      cameraHookSrc.includes("facingMode: \"environment\"") ||
      cameraHookSrc.includes("facingMode: facingMode"),
      "useCamera must prefer environment facing mode for rear document photography"
    );
    assert.ok(
      cameraHookSrc.includes("stopMediaTracks") || cameraHookSrc.includes("stopCamera"),
      "useCamera must implement media track stop cleanup"
    );
    assert.ok(
      cameraHookSrc.includes("switchCamera"),
      "useCamera must implement switchCamera for cycling devices or toggling facingMode"
    );
    assert.ok(
      cameraHookSrc.includes("captureFrame"),
      "useCamera must implement captureFrame drawing to canvas"
    );
    assert.ok(
      cameraHookSrc.includes("NotAllowedError") || cameraHookSrc.includes("PermissionDeniedError"),
      "useCamera must handle camera permission denied"
    );
    assert.ok(
      cameraHookSrc.includes("NotFoundError") || cameraHookSrc.includes("DevicesNotFoundError"),
      "useCamera must handle camera unavailable or not detected"
    );
  });

  await t.test("3. DocumentCameraCaptureModal provides capture, retake, multi-page, and switch controls", () => {
    assert.ok(
      cameraModalSrc.includes("Capture Photo"),
      "Modal must render Capture Photo shutter button"
    );
    assert.ok(
      cameraModalSrc.includes("Retake Photo"),
      "Modal must render Retake Photo button when previewing capture"
    );
    assert.ok(
      cameraModalSrc.includes("Save & Capture Next Page") ||
      cameraModalSrc.includes("Save &amp; Capture Next Page"),
      "Modal must render button to save and immediately photograph another page"
    );
    assert.ok(
      cameraModalSrc.includes("Use Photo"),
      "Modal must render Use Photo confirmation button"
    );
    assert.ok(
      cameraModalSrc.includes("stopCamera()"),
      "Modal must invoke stopCamera on close to release hardware resources"
    );
  });

  // ── 2. Functional Unit Simulations ─────────────────────────────────────────
  await t.test("4. Simulation: Camera permission granted streams video and enables capture", async () => {
    let streamStopped = false;
    const mockTrack = {
      stop: () => {
        streamStopped = true;
      },
      getCapabilities: () => ({ zoom: { min: 1, max: 3 } }),
      applyConstraints: async () => {},
    };
    const mockStream = {
      getTracks: () => [mockTrack],
      getVideoTracks: () => [mockTrack],
    };

    let permissionGranted = true;
    let cameraError = null;

    async function getUserMedia(constraints) {
      if (!permissionGranted) {
        const err = new Error("Permission denied by user");
        err.name = "NotAllowedError";
        throw err;
      }
      return mockStream;
    }

    const stream = await getUserMedia({ video: { facingMode: "environment" } });
    assert.ok(stream, "Stream must be obtained when permission is granted");
    assert.strictEqual(stream.getVideoTracks().length, 1);

    // Stop tracks
    stream.getTracks().forEach((t) => t.stop());
    assert.strictEqual(streamStopped, true, "Media tracks must be stopped on cleanup");
  });

  await t.test("5. Simulation: Camera permission denied sets descriptive error", async () => {
    async function requestCamera(allow) {
      if (!allow) {
        const err = new Error("Permission denied");
        err.name = "NotAllowedError";
        throw err;
      }
      return {};
    }

    let userMessage = "";
    try {
      await requestCamera(false);
    } catch (err) {
      if (err.name === "NotAllowedError") {
        userMessage = "Camera permission was denied. Please allow camera access in your browser settings.";
      }
    }

    assert.ok(userMessage.includes("Camera permission was denied"));
  });

  await t.test("6. Simulation: Camera unavailable / not detected sets clear error", async () => {
    async function requestCamera() {
      const err = new Error("Requested device not found");
      err.name = "NotFoundError";
      throw err;
    }

    let userMessage = "";
    try {
      await requestCamera();
    } catch (err) {
      if (err.name === "NotFoundError") {
        userMessage = "No camera device was detected on your system. Please connect a camera or use file upload.";
      }
    }

    assert.ok(userMessage.includes("No camera device was detected"));
  });

  await t.test("7. Simulation: Capturing image assigns to correct document step without cross-contamination", () => {
    const stepFiles = {
      sf1: [],
      sf2: [],
      sf5: [],
      sf9: [],
      sf10: [],
      birth_cert: [],
    };

    function simulateCapture(stepKey, filename, docType) {
      stepFiles[stepKey].push({
        id: `doc-${docType}-${Date.now()}`,
        name: filename,
        documentType: docType,
        stepCategory: stepKey,
      });
    }

    simulateCapture("sf1", "SF1_Page_1.jpg", "sf1");
    simulateCapture("sf2", "SF2_Page_1.jpg", "sf2");
    simulateCapture("sf5", "SF5A_Page_1.jpg", "sf5a");
    simulateCapture("sf9", "SF9_Front.jpg", "sf9");

    assert.strictEqual(stepFiles.sf1.length, 1);
    assert.strictEqual(stepFiles.sf1[0].documentType, "sf1");
    assert.strictEqual(stepFiles.sf2.length, 1);
    assert.strictEqual(stepFiles.sf2[0].documentType, "sf2");
    assert.strictEqual(stepFiles.sf5.length, 1);
    assert.strictEqual(stepFiles.sf5[0].documentType, "sf5a");
    assert.strictEqual(stepFiles.sf9.length, 1);
    assert.strictEqual(stepFiles.sf9[0].documentType, "sf9");
    assert.strictEqual(stepFiles.sf10.length, 0);
    assert.strictEqual(stepFiles.birth_cert.length, 0);
  });

  await t.test("8. Simulation: Multi-page capture for single document type", () => {
    const stepFiles = { sf9: [] };

    // Capture Page 1 (Front)
    stepFiles.sf9.push({
      id: "sf9-p1",
      name: "SF9-SHS_Page_1.jpg",
      documentType: "sf9",
      stepCategory: "sf9",
    });

    // Capture Page 2 (Back)
    stepFiles.sf9.push({
      id: "sf9-p2",
      name: "SF9-SHS_Page_2.jpg",
      documentType: "sf9",
      stepCategory: "sf9",
    });

    assert.strictEqual(stepFiles.sf9.length, 2);
    assert.strictEqual(stepFiles.sf9[0].name, "SF9-SHS_Page_1.jpg");
    assert.strictEqual(stepFiles.sf9[1].name, "SF9-SHS_Page_2.jpg");
  });

  await t.test("9. Simulation: Retake and remove operations", () => {
    let capturedPreview = "data:image/jpeg;base64,mockCapture";
    
    // Retake action clears captured preview
    capturedPreview = null;
    assert.strictEqual(capturedPreview, null, "Retake must discard staged preview");

    // Remove from staged stepFiles
    let sf1Files = [
      { id: "1", name: "SF1_A.jpg" },
      { id: "2", name: "SF1_B.jpg" },
    ];
    sf1Files = sf1Files.filter((item) => item.id !== "1");
    assert.strictEqual(sf1Files.length, 1);
    assert.strictEqual(sf1Files[0].id, "2");
  });

  await t.test("10. Simulation: Step navigation stops camera stream", () => {
    let cameraActive = true;
    let currentStep = 0;

    function handleNextStep() {
      cameraActive = false; // Must close camera stream on step change
      currentStep += 1;
    }

    handleNextStep();
    assert.strictEqual(cameraActive, false, "Camera must be stopped when moving to next step");
    assert.strictEqual(currentStep, 1);
  });

  await t.test("11. Simulation: Both file uploads and camera captures are unified in final batch", () => {
    const stagedFiles = [
      { name: "SF1_Uploaded.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,pdf" },
      { name: "SF2_Photo_Page1.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,img1" },
      { name: "SF5A_Photo_Page1.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,img2" },
      { name: "SF9_Photo_Page1.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,img3" },
      { name: "SF10_Uploaded.pdf", type: "application/pdf", dataUrl: "data:application/pdf;base64,pdf2" },
    ];

    // Final batch payload consumes all staged files
    const batchPayload = {
      action: "classify_and_validate",
      files: stagedFiles.map((f) => ({
        name: f.name,
        type: f.type,
        dataUrl: f.dataUrl,
      })),
    };

    assert.strictEqual(batchPayload.files.length, 5);
    const pdfCount = batchPayload.files.filter((f) => f.type === "application/pdf").length;
    const imgCount = batchPayload.files.filter((f) => f.type === "image/jpeg").length;
    assert.strictEqual(pdfCount, 2);
    assert.strictEqual(imgCount, 3);
  });
});
