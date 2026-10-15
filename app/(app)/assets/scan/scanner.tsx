"use client";

// Barcode look-up: handheld scanner, phone camera, or typing.
//
// • Handheld USB/Bluetooth scanners act like a keyboard: they type the code
//   and press Enter. The input below is focused and ready, so a scan submits
//   immediately — no camera, no extra software.
// • The camera is optional. It is requested ONLY when the person taps
//   "Start camera", and decoding (ZXing, Code 128 and Code 39) happens in the
//   browser; nothing is uploaded.
// • Scanned text is untrusted: it is checked, sent to the server, and the app
//   only ever navigates to an address the server built from a validated asset
//   id. A barcode cannot open another website or run script.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { parseAssetCode } from "@/lib/asset-code";
import { lookupAssetCodeAction } from "../actions";

type CameraState = "idle" | "starting" | "scanning" | "unavailable";
type Controls = { stop: () => void };

export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<Controls | null>(null);
  const handledRef = useRef(false);
  const [camera, setCamera] = useState<CameraState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function stopCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCamera((c) => (c === "unavailable" ? c : "idle"));
  }

  useEffect(() => () => controlsRef.current?.stop(), []);

  function lookUp(text: string) {
    const parsed = parseAssetCode(text);
    if (parsed.kind === "invalid") {
      setMessage(parsed.reason);
      return;
    }
    setMessage(`Looking up ${parsed.code}…`);
    startTransition(async () => {
      const result = await lookupAssetCodeAction(parsed.code);
      if (result.ok && result.href.startsWith("/assets/")) {
        router.push(result.href);
      } else {
        setMessage(result.ok ? "Unexpected response. Please try again." : result.message);
        // Ready for the next handheld scan.
        if (inputRef.current) {
          inputRef.current.value = "";
          inputRef.current.focus();
        }
      }
    });
  }

  async function startCamera() {
    setMessage(null);
    handledRef.current = false;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCamera("unavailable");
      setMessage(
        "Camera scanning needs a secure (https) connection and a browser with camera support. Use a handheld scanner or type the asset ID instead.",
      );
      return;
    }
    setCamera("starting");
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false },
        videoRef.current!,
        (result) => {
          if (!result || handledRef.current) return;
          handledRef.current = true;
          stopCamera();
          lookUp(result.getText());
        },
      );
      setCamera("scanning");
    } catch (error) {
      stopCamera();
      const name = error instanceof DOMException ? error.name : "";
      setCamera("unavailable");
      setMessage(
        name === "NotAllowedError"
          ? "Camera permission was not given. You can allow it in your browser settings, or use a handheld scanner or type the asset ID."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "No camera was found on this device. Use a handheld scanner or type the asset ID."
            : "The camera could not be started. Use a handheld scanner or type the asset ID.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="entry-heading" className="flex flex-col gap-3">
        <h2 id="entry-heading" className="text-base font-semibold">
          Scan with a barcode scanner, or type the asset ID
        </h2>
        <p className="text-ink-muted text-sm">
          With a handheld USB or Bluetooth scanner, just scan the label: the box below is ready. You can also type an
          asset ID (e.g. INF-0412) or the hospital&apos;s own inventory number.
        </p>
        <form
          className="flex max-w-md flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const value = new FormData(e.currentTarget).get("code");
            lookUp(typeof value === "string" ? value : "");
          }}
        >
          <div className="flex-1">
            <InputField
              ref={inputRef}
              label="Asset ID or barcode"
              name="code"
              id="manual-code"
              placeholder="INF-0412"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={60}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Searching…" : "Find asset"}
          </Button>
        </form>
      </section>

      <section aria-labelledby="camera-heading" className="flex flex-col gap-3">
        <h2 id="camera-heading" className="text-base font-semibold">
          Or use this device&apos;s camera
        </h2>
        <p className="text-ink-muted text-sm">
          Optional. Your browser will ask for camera access so it can read the barcode on the equipment label. The video
          stays on this device and is not recorded or uploaded. Hold the barcode flat and fill most of the frame with
          it.
        </p>
        <div
          className={`bg-navy-950 relative aspect-[4/3] w-full max-w-md overflow-hidden rounded-md ${camera === "scanning" || camera === "starting" ? "" : "hidden"}`}
        >
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted aria-label="Camera preview" />
          <div
            className="pointer-events-none absolute inset-x-[10%] top-[35%] bottom-[35%] rounded-md border-2 border-teal-400"
            aria-hidden
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {camera === "scanning" || camera === "starting" ? (
            <Button variant="secondary" onClick={stopCamera}>
              Stop camera
            </Button>
          ) : (
            <Button variant="secondary" onClick={startCamera} disabled={pending}>
              Start camera
            </Button>
          )}
        </div>
        {camera === "scanning" ? (
          <p className="text-ink-muted text-sm" aria-live="polite">
            Point the camera at the barcode on the label.
          </p>
        ) : null}
      </section>

      {message ? (
        <p role="status" aria-live="polite" className="bg-surface-sunken rounded-sm px-3 py-2 text-sm font-medium">
          {message}
        </p>
      ) : null}
    </div>
  );
}
