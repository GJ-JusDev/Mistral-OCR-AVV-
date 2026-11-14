import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_ADJUSTMENTS,
  MIN_OCR_DIMENSION,
  computeStdDev,
  getContainedImageRect,
  processImage,
  readFileAsDataUrl,
  resolveEffectiveAdjustments,
  sharpenImageData,
} from "../src/lib/ocr/image-utils.ts";
import { resolveOcrExtractionRequest } from "../src/lib/upload/uploadWorkflow.ts";

test("AVV — Hide Image Adjustments Panel Verification Suite", async (t) => {
  await t.test("1. Upload Document UI omits ImageAdjustments panel with no empty wrapper across SF9, SF10, and PSA", () => {
    const uploadPageSrc = fs.readFileSync(
      path.resolve("./src/app/upload/page.tsx"),
      "utf8"
    );

    assert.strictEqual(
      uploadPageSrc.includes("ImageAdjustments"),
      false,
      "UploadPage must not import or render ImageAdjustments"
    );
    assert.strictEqual(
      /\bsetAdjustments\b/.test(uploadPageSrc),
      false,
      "UploadPage must not expose or wire setAdjustments"
    );
    assert.ok(
      uploadPageSrc.includes("useImageProcessor({ lockDefaultAdjustments: true })"),
      "UploadPage must lock useImageProcessor to DEFAULT_ADJUSTMENTS"
    );

    // Ensure ImagePreview flows directly into the action buttons container with no leftover empty div/spacer
    assert.match(
      uploadPageSrc,
      /onPointerUp=\{onPointerUp\}\s*\/>\s*<div className="flex flex-col gap-3">/,
      "No empty container or spacer should remain between ImagePreview and the action buttons container"
    );

    // Confirm SF9 and SF10 category controls remain present and PSA is omitted
    assert.ok(uploadPageSrc.includes('handleCategoryChange("sf9")'));
    assert.ok(uploadPageSrc.includes('handleCategoryChange("sf10")'));
    assert.ok(!uploadPageSrc.includes('handleCategoryChange("birth_cert")'));
  });

  await t.test("2. Camera selector, zoom controls, Capture Frame, File Upload, previews, and Extract Data remain intact", () => {
    const uploadPageSrc = fs.readFileSync(
      path.resolve("./src/app/upload/page.tsx"),
      "utf8"
    );
    const cameraControlsSrc = fs.readFileSync(
      path.resolve("./src/components/camera/CameraControls.tsx"),
      "utf8"
    );
    const uploaderSrc = fs.readFileSync(
      path.resolve("./src/components/camera/ImageUploader.tsx"),
      "utf8"
    );
    const extractBtnSrc = fs.readFileSync(
      path.resolve("./src/components/ocr/ExtractButton.tsx"),
      "utf8"
    );

    // UploadPage wires CameraFeed, CameraControls, ImageUploader, ImagePreview, and ExtractButton
    assert.ok(uploadPageSrc.includes("<CameraFeed"), "CameraFeed must remain rendered");
    assert.ok(uploadPageSrc.includes("<CameraControls"), "CameraControls must remain rendered");
    assert.ok(uploadPageSrc.includes("<ImageUploader"), "ImageUploader must remain rendered");
    assert.ok(uploadPageSrc.includes("<ImagePreview"), "ImagePreview must remain rendered");
    assert.ok(uploadPageSrc.includes("<ExtractButton"), "ExtractButton must remain rendered");

    // CameraControls preserves camera selector, zoom controls, and Capture Frame button
    assert.ok(cameraControlsSrc.includes('id="camera-select"'), "Camera selector must remain visible");
    assert.ok(cameraControlsSrc.includes("Zoom ("), "Zoom label and controls must remain visible");
    assert.ok(cameraControlsSrc.includes("Capture Frame"), "Capture Frame button must remain visible");

    // ImageUploader and ExtractButton preserve Browse Files and Extract Data
    assert.ok(uploaderSrc.includes("Browse Files"), "File upload Browse Files button must remain visible");
    assert.ok(extractBtnSrc.includes('"Extract Data"'), "Extract Data button label must remain intact");
  });

  await t.test("3. Locked default adjustments prevent accidental retention or mutation of non-default values", () => {
    assert.deepStrictEqual(DEFAULT_ADJUSTMENTS, {
      brightness: 200,
      contrast: 100,
      sharpness: 0,
    });
    assert.strictEqual(
      Object.isFrozen(DEFAULT_ADJUSTMENTS),
      true,
      "DEFAULT_ADJUSTMENTS must be frozen against accidental in-place mutation"
    );

    assert.throws(() => {
      // @ts-expect-error verifying runtime immutability
      DEFAULT_ADJUSTMENTS.brightness = 125;
    }, TypeError);

    // When locked, any non-default adjustment values are discarded in favor of DEFAULT_ADJUSTMENTS
    const locked = resolveEffectiveAdjustments(
      { brightness: 80, contrast: 175, sharpness: 65 },
      { lockDefaults: true }
    );
    assert.strictEqual(locked, DEFAULT_ADJUSTMENTS);

    // Missing or invalid fields fall back safely to DEFAULT_ADJUSTMENTS
    assert.strictEqual(resolveEffectiveAdjustments(null), DEFAULT_ADJUSTMENTS);
    assert.strictEqual(resolveEffectiveAdjustments(undefined), DEFAULT_ADJUSTMENTS);
    assert.strictEqual(
      resolveEffectiveAdjustments({ brightness: Number.NaN, contrast: 100, sharpness: 0 }),
      DEFAULT_ADJUSTMENTS
    );

    // Verify useImageProcessor enforces lockDefaults inside both state updates and onload processing
    const hookSrc = fs.readFileSync(
      path.resolve("./src/hooks/useImageProcessor.ts"),
      "utf8"
    );
    assert.ok(
      hookSrc.includes("resolveEffectiveAdjustments(adjustments, { lockDefaults })"),
      "useImageProcessor must resolve adjustments with lockDefaults"
    );
  });

  await t.test("4. Automatic OCR preprocessing functions remain preserved and produce identical default output", () => {
    // Verify preprocessing helpers are preserved
    assert.strictEqual(typeof sharpenImageData, "function");
    assert.strictEqual(typeof computeStdDev, "function");
    assert.strictEqual(typeof getContainedImageRect, "function");
    assert.strictEqual(typeof readFileAsDataUrl, "function");
    assert.strictEqual(typeof processImage, "function");

    const samplePixels = new Uint8ClampedArray([
      20, 20, 20, 255,
      240, 240, 240, 255,
      30, 30, 30, 255,
      220, 220, 220, 255,
    ]);
    assert.ok(computeStdDev({ data: samplePixels, width: 2, height: 2 }) > 0);
    const sharpened = sharpenImageData(
      { data: new Uint8ClampedArray(samplePixels), width: 2, height: 2 },
      0.5
    );
    assert.strictEqual(sharpened.data.length, samplePixels.length);

    // Mock minimal canvas in globalThis.document to verify processImage default pipeline
    const originalDocument = globalThis.document;
    const recordedCalls = [];

    globalThis.document = {
      createElement(tag) {
        assert.strictEqual(tag, "canvas");
        const record = {
          width: 0,
          height: 0,
          filtersApplied: [],
          drawArgs: null,
          getImageDataCalled: false,
          toDataUrlArgs: null,
        };
        recordedCalls.push(record);
        const ctx = {
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "low",
          _filter: "none",
          set filter(val) {
            this._filter = val;
            record.filtersApplied.push(val);
          },
          get filter() {
            return this._filter;
          },
          drawImage(...args) {
            record.drawArgs = args;
          },
          getImageData() {
            record.getImageDataCalled = true;
            return { data: new Uint8ClampedArray(16), width: 2, height: 2 };
          },
          putImageData() {},
        };
        return {
          set width(w) {
            record.width = w;
          },
          get width() {
            return record.width;
          },
          set height(h) {
            record.height = h;
          },
          get height() {
            return record.height;
          },
          getContext(type) {
            assert.strictEqual(type, "2d");
            return ctx;
          },
          toDataURL(mime, quality) {
            record.toDataUrlArgs = [mime, quality];
            return `data:${mime};q=${quality};w=${record.width};h=${record.height};f=${record.filtersApplied[0]}`;
          },
        };
      },
    };

    try {
      const sourceImage = {
        naturalWidth: 800,
        naturalHeight: 600,
        src: "data:image/jpeg;base64,rawSource",
      };

      // Baseline output using explicit DEFAULT_ADJUSTMENTS (before hiding panel)
      const baselineUrl = processImage(sourceImage, {
        brightness: 200,
        contrast: 100,
        sharpness: 0,
      });

      // Output with hidden/locked adjustment resolution
      const lockedEffective = resolveEffectiveAdjustments(
        { brightness: 120, contrast: 160, sharpness: 40 },
        { lockDefaults: true }
      );
      const hiddenPanelUrl = processImage(sourceImage, lockedEffective);

      assert.strictEqual(
        hiddenPanelUrl,
        baselineUrl,
        "Document image submitted to OCR must be identical to the intended default-settings output"
      );

      // Confirm automatic upscaling to MIN_OCR_DIMENSION (1600px long edge: 800x600 -> 1600x1200)
      assert.strictEqual(recordedCalls[1].width, MIN_OCR_DIMENSION);
      assert.strictEqual(recordedCalls[1].height, 1200);
      assert.strictEqual(recordedCalls[1].filtersApplied[0], "brightness(200%) contrast(100%)");
      assert.strictEqual(recordedCalls[1].getImageDataCalled, false, "Default sharpness=0 must not run sharpen convolution");
      assert.deepStrictEqual(recordedCalls[1].toDataUrlArgs, ["image/jpeg", 0.92]);

      // Confirm SF9 and SF10 OCR request resolution forwards the preprocessed image unchanged
      const sf9Req = resolveOcrExtractionRequest({
        docCategory: "sf9",
        workflowType: "two_sided",
        gradeLevel: "Senior High School",
        singleImage: hiddenPanelUrl,
        frontImage: hiddenPanelUrl,
        backImage: hiddenPanelUrl,
      });
      assert.strictEqual(sf9Req?.kind, "two_sided");
      assert.strictEqual(sf9Req?.frontImage, baselineUrl);
      assert.strictEqual(sf9Req?.backImage, baselineUrl);

      const sf10Req = resolveOcrExtractionRequest({
        docCategory: "sf10",
        workflowType: "single",
        gradeLevel: "High School",
        singleImage: hiddenPanelUrl,
        frontImage: null,
        backImage: null,
      });
      assert.strictEqual(sf10Req?.kind, "single");
      assert.strictEqual(sf10Req?.image, baselineUrl);

      const unsupportedPsaReq = resolveOcrExtractionRequest({
        docCategory: "birth_cert",
        workflowType: "single",
        gradeLevel: "Senior High School",
        singleImage: hiddenPanelUrl,
        frontImage: null,
        backImage: null,
      });
      assert.strictEqual(unsupportedPsaReq, null);
    } finally {
      globalThis.document = originalDocument;
    }
  });
});
