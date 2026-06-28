import { ImagePlus, Upload, ZoomIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const CROP_CANVAS_SIZE = 320;
const PREVIEW_SIZE = 96;

type ImageCropShape = "circle" | "rounded-square";

interface ImageCropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceUrl: string;
  fileName?: string;
  title: string;
  description: string;
  applyLabel: string;
  previewAlt: string;
  currentImageUrl?: string;
  currentFallback?: ReactNode;
  cropShape?: ImageCropShape;
  outputSize?: number;
  outputType?: "image/jpeg" | "image/png" | "image/webp";
  outputQuality?: number;
  outputBackgroundColor?: string | null;
  onApply: (dataUrl: string) => void;
}

export function ImageCropDialog({
  open,
  onOpenChange,
  sourceUrl,
  fileName,
  title,
  description,
  applyLabel,
  previewAlt,
  currentImageUrl,
  currentFallback,
  cropShape = "circle",
  outputSize = 256,
  outputType = "image/jpeg",
  outputQuality = 0.88,
  outputBackgroundColor = "#ffffff",
  onApply,
}: ImageCropDialogProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const drawCropCanvas = useCallback(
    (image: HTMLImageElement, scaleValue: number, offsetValue: { x: number; y: number }) => {
      const canvas = cropCanvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context || !image.naturalWidth || !image.naturalHeight) return;

      canvas.width = CROP_CANVAS_SIZE;
      canvas.height = CROP_CANVAS_SIZE;
      const draw = getImageDrawRect(image, CROP_CANVAS_SIZE, scaleValue, offsetValue);

      context.clearRect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE);
      context.fillStyle = "#f8fafc";
      context.fillRect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE);
      context.drawImage(image, draw.dx, draw.dy, draw.dw, draw.dh);

      context.save();
      context.fillStyle = "rgba(15, 23, 42, 0.48)";
      context.fillRect(0, 0, CROP_CANVAS_SIZE, CROP_CANVAS_SIZE);
      context.globalCompositeOperation = "destination-out";
      drawCropPath(context, cropShape, CROP_CANVAS_SIZE);
      context.fill();
      context.restore();

      context.save();
      drawCropPath(context, cropShape, CROP_CANVAS_SIZE);
      context.strokeStyle = "rgba(255, 255, 255, 0.92)";
      context.lineWidth = 2;
      context.stroke();
      context.restore();

      drawPreviewCanvas(previewCanvasRef.current, image, scaleValue, offsetValue, cropShape);
    },
    [cropShape],
  );

  useEffect(() => {
    if (!open || !sourceUrl) return undefined;
    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      setScale(1);
      setOffset({ x: 0, y: 0 });
      drawCropCanvas(image, 1, { x: 0, y: 0 });
    };
    image.src = sourceUrl;
    return () => {
      if (imageRef.current === image) imageRef.current = null;
    };
  }, [drawCropCanvas, open, sourceUrl]);

  useEffect(() => {
    const image = imageRef.current;
    if (image) drawCropCanvas(image, scale, offset);
  }, [drawCropCanvas, offset, scale]);

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    const image = imageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !image) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setOffset((current) => clampImageOffset(image, { x: current.x + dx, y: current.y + dy }, scale));
  }

  function handlePointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function applyCrop() {
    const image = imageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = getImageDrawRect(image, outputSize, scale, {
      x: offset.x * (outputSize / CROP_CANVAS_SIZE),
      y: offset.y * (outputSize / CROP_CANVAS_SIZE),
    });
    if (outputBackgroundColor) {
      context.fillStyle = outputBackgroundColor;
      context.fillRect(0, 0, outputSize, outputSize);
    }
    context.drawImage(image, draw.dx, draw.dy, draw.dw, draw.dh);
    onApply(canvas.toDataURL(outputType, outputQuality));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="shrink-0 border-b border-border-light px-4 pb-3 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md bg-muted/50 ring-1 ring-border">
              <ImagePlus className="size-4 text-foreground" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <div className="grid gap-3 md:grid-cols-[340px_1fr]">
            <CropSection title="裁剪区域" description={fileName || "图片"}>
              <div className="rounded-lg border border-border bg-muted/50 p-4">
                <canvas
                  ref={cropCanvasRef}
                  className="mx-auto size-[320px] max-w-full cursor-grab rounded-md bg-background shadow-sm active:cursor-grabbing"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerEnd}
                  onPointerCancel={handlePointerEnd}
                />
              </div>
            </CropSection>

            <div className="space-y-3">
              <CropSection
                title="预览"
                description={
                  cropShape === "circle" ? "圆形区域就是最终头像展示范围。" : "方形区域就是最终 Logo 输出范围。"
                }
              >
                <div className="flex items-end gap-4">
                  <canvas
                    ref={previewCanvasRef}
                    className={cn(
                      "size-24 border border-border-light bg-muted/50",
                      cropShape === "circle" ? "rounded-full" : "rounded-[18px]",
                    )}
                  />
                  {currentImageUrl || currentFallback ? (
                    cropShape === "circle" ? (
                      <Avatar className="size-12 border border-border-light">
                        <AvatarImage src={currentImageUrl} alt={previewAlt} />
                        <AvatarFallback className="bg-primary/10 text-primary">{currentFallback}</AvatarFallback>
                      </Avatar>
                    ) : (
                      <div className="flex size-12 items-center justify-center overflow-hidden rounded-lg border border-border-light bg-muted/40">
                        {currentImageUrl ? (
                          <img src={currentImageUrl} alt={previewAlt} className="size-10 object-contain" />
                        ) : (
                          currentFallback
                        )}
                      </div>
                    )
                  ) : null}
                </div>
                <div className="mt-3 text-xs leading-5 text-muted-foreground">拖动图片调整位置。</div>
              </CropSection>

              <CropSection title="调整" description="放大图片可获得更聚焦的画面。">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <ZoomIn className="size-3.5" /> 缩放
                    </span>
                    <span>{scale.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.05"
                    value={scale}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setScale(next);
                      const image = imageRef.current;
                      if (image) setOffset((current) => clampImageOffset(image, current, next));
                    }}
                    className="w-full accent-primary"
                  />
                </div>
              </CropSection>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-border-light px-4 py-3">
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button onClick={applyCrop}>
              <Upload className="size-4" />
              {applyLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CropSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border-light bg-background">
      <div className="border-b border-border-light px-4 py-3">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description ? <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function getImageDrawRect(
  image: HTMLImageElement,
  size: number,
  scaleValue: number,
  offsetValue: { x: number; y: number },
) {
  const baseScale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
  const scale = baseScale * scaleValue;
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  const boundX = Math.max(0, (dw - size) / 2);
  const boundY = Math.max(0, (dh - size) / 2);
  const x = Math.max(-boundX, Math.min(boundX, offsetValue.x));
  const y = Math.max(-boundY, Math.min(boundY, offsetValue.y));
  return {
    dx: (size - dw) / 2 + x,
    dy: (size - dh) / 2 + y,
    dw,
    dh,
  };
}

function drawPreviewCanvas(
  previewCanvas: HTMLCanvasElement | null,
  image: HTMLImageElement,
  scaleValue: number,
  offsetValue: { x: number; y: number },
  shape: ImageCropShape,
) {
  const context = previewCanvas?.getContext("2d");
  if (!previewCanvas || !context || !image.naturalWidth || !image.naturalHeight) return;
  const offsetScale = PREVIEW_SIZE / CROP_CANVAS_SIZE;
  previewCanvas.width = PREVIEW_SIZE;
  previewCanvas.height = PREVIEW_SIZE;
  const draw = getImageDrawRect(image, PREVIEW_SIZE, scaleValue, {
    x: offsetValue.x * offsetScale,
    y: offsetValue.y * offsetScale,
  });

  context.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  context.save();
  drawCropPath(context, shape, PREVIEW_SIZE);
  context.clip();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  context.drawImage(image, draw.dx, draw.dy, draw.dw, draw.dh);
  context.restore();
}

function clampImageOffset(image: HTMLImageElement, offset: { x: number; y: number }, scaleValue: number) {
  const baseScale = Math.max(CROP_CANVAS_SIZE / image.naturalWidth, CROP_CANVAS_SIZE / image.naturalHeight);
  const dw = image.naturalWidth * baseScale * scaleValue;
  const dh = image.naturalHeight * baseScale * scaleValue;
  const boundX = Math.max(0, (dw - CROP_CANVAS_SIZE) / 2);
  const boundY = Math.max(0, (dh - CROP_CANVAS_SIZE) / 2);
  return {
    x: Math.max(-boundX, Math.min(boundX, offset.x)),
    y: Math.max(-boundY, Math.min(boundY, offset.y)),
  };
}

function drawCropPath(context: CanvasRenderingContext2D, shape: ImageCropShape, size: number) {
  context.beginPath();
  if (shape === "circle") {
    context.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    return;
  }
  roundedRectPath(context, 2, 2, size - 4, size - 4, Math.max(12, size * 0.08));
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
}
