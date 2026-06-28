import { type PointerEvent, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, ImagePlus, LoaderCircle, Upload, ZoomIn } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface UserProfileFormValue {
  displayName: string;
  avatarUrl: string;
  bio: string;
  location: string;
  website: string;
}

interface UserProfileEditorProps {
  value: UserProfileFormValue;
  onChange: (value: UserProfileFormValue) => void;
  onSubmit: () => void;
  displayName: string;
  email?: string;
  loading?: boolean;
  saving?: boolean;
  message?: string | null;
  error?: string | null;
  submitLabel?: string;
  savingLabel?: string;
  description?: string;
  onCancel?: () => void;
  cancelLabel?: string;
  className?: string;
}

const AVATAR_CANVAS_SIZE = 320;
const AVATAR_OUTPUT_SIZE = 256;

export const emptyUserProfileForm: UserProfileFormValue = {
  displayName: "",
  avatarUrl: "",
  bio: "",
  location: "",
  website: "",
};

export function toUserProfileForm(user: Partial<UserProfileFormValue> | null | undefined): UserProfileFormValue {
  return {
    displayName: user?.displayName ?? "",
    avatarUrl: user?.avatarUrl ?? "",
    bio: user?.bio ?? "",
    location: user?.location ?? "",
    website: user?.website ?? "",
  };
}

export function UserProfileEditor({
  value,
  onChange,
  onSubmit,
  displayName,
  email,
  loading = false,
  saving = false,
  message,
  error,
  submitLabel = "保存资料",
  savingLabel = "正在保存",
  description = "补充基础信息，方便管理员识别你的身份与使用场景。",
  onCancel,
  cancelLabel = "取消",
  className,
}: UserProfileEditorProps) {
  const id = useId();
  const [avatarDragActive, setAvatarDragActive] = useState(false);
  const [avatarEditorOpen, setAvatarEditorOpen] = useState(false);
  const [avatarSourceUrl, setAvatarSourceUrl] = useState("");
  const [avatarFileName, setAvatarFileName] = useState("");
  const [avatarScale, setAvatarScale] = useState(1);
  const [avatarOffset, setAvatarOffset] = useState({ x: 0, y: 0 });
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avatarImageRef = useRef<HTMLImageElement | null>(null);
  const avatarDragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const resolvedDisplayName = value.displayName || displayName || "用户";

  useEffect(() => {
    if (!avatarSourceUrl) return undefined;
    const image = new Image();
    image.onload = () => {
      avatarImageRef.current = image;
      const nextOffset = { x: 0, y: 0 };
      setAvatarOffset(nextOffset);
      drawAvatarCanvas(image, avatarScale, nextOffset);
    };
    image.src = avatarSourceUrl;
    return () => {
      if (avatarImageRef.current === image) avatarImageRef.current = null;
    };
  }, [avatarSourceUrl]);

  useEffect(() => {
    const image = avatarImageRef.current;
    if (image) drawAvatarCanvas(image, avatarScale, avatarOffset);
  }, [avatarOffset, avatarScale, avatarSourceUrl]);

  useEffect(() => {
    return () => {
      if (avatarSourceUrl.startsWith("blob:")) URL.revokeObjectURL(avatarSourceUrl);
    };
  }, [avatarSourceUrl]);

  function updateField(field: keyof UserProfileFormValue, nextValue: string) {
    onChange({ ...value, [field]: nextValue });
  }

  function openAvatarEditor(file?: File) {
    if (!file) return;
    setAvatarError(null);
    if (!file.type.startsWith("image/")) {
      setAvatarError("请选择 PNG、JPG、WebP 等图片文件。");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setAvatarError("图片不能超过 6MB。");
      return;
    }
    if (avatarSourceUrl.startsWith("blob:")) URL.revokeObjectURL(avatarSourceUrl);
    setAvatarSourceUrl(URL.createObjectURL(file));
    setAvatarFileName(file.name);
    setAvatarScale(1);
    setAvatarOffset({ x: 0, y: 0 });
    setAvatarEditorOpen(true);
  }

  function drawAvatarCanvas(image: HTMLImageElement, scaleValue: number, offsetValue: { x: number; y: number }) {
    const canvas = avatarCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !image.naturalWidth || !image.naturalHeight) return;

    canvas.width = AVATAR_CANVAS_SIZE;
    canvas.height = AVATAR_CANVAS_SIZE;
    const draw = getAvatarDrawRect(image, AVATAR_CANVAS_SIZE, scaleValue, offsetValue);

    context.clearRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
    context.drawImage(image, draw.dx, draw.dy, draw.dw, draw.dh);

    context.save();
    context.fillStyle = "rgba(15, 23, 42, 0.48)";
    context.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
    context.globalCompositeOperation = "destination-out";
    context.beginPath();
    context.arc(AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2 - 2, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.beginPath();
    context.arc(AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2, AVATAR_CANVAS_SIZE / 2 - 2, 0, Math.PI * 2);
    context.strokeStyle = "rgba(255, 255, 255, 0.92)";
    context.lineWidth = 2;
    context.stroke();

    drawAvatarPreview(avatarPreviewCanvasRef.current, image, scaleValue, offsetValue);
  }

  function handleAvatarPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    avatarDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleAvatarPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const drag = avatarDragRef.current;
    const image = avatarImageRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !image) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    avatarDragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setAvatarOffset((current) => clampAvatarOffset(image, { x: current.x + dx, y: current.y + dy }, avatarScale));
  }

  function handleAvatarPointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    if (avatarDragRef.current?.pointerId === event.pointerId) avatarDragRef.current = null;
  }

  function applyCroppedAvatar() {
    const image = avatarImageRef.current;
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;
    const draw = getAvatarDrawRect(image, AVATAR_OUTPUT_SIZE, avatarScale, {
      x: avatarOffset.x * (AVATAR_OUTPUT_SIZE / AVATAR_CANVAS_SIZE),
      y: avatarOffset.y * (AVATAR_OUTPUT_SIZE / AVATAR_CANVAS_SIZE),
    });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
    context.drawImage(image, draw.dx, draw.dy, draw.dw, draw.dh);
    updateField("avatarUrl", canvas.toDataURL("image/jpeg", 0.88));
    setAvatarEditorOpen(false);
  }

  if (loading) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        正在加载资料
      </div>
    );
  }

  return (
    <>
      <form
        className={cn("overflow-hidden rounded-md border border-border-light bg-background", className)}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="border-b border-border-light px-4 py-3">
          <div className="text-sm font-semibold text-foreground">个人资料</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
        </div>

        {(message || error) && (
          <div className="px-4 pt-4">
            <div className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
              error ? "border-red-100 bg-red-50 text-red-600" : "border-emerald-100 bg-emerald-50 text-emerald-700",
            )}>
              {!error && <CheckCircle2 className="size-4" />}
              {error || message}
            </div>
          </div>
        )}

        <div className="grid gap-0 md:grid-cols-[220px_1fr]">
          <div className="border-b border-border-light bg-muted/40 p-4 md:border-b-0 md:border-r">
            <div className="flex flex-col items-center text-center">
              <Avatar className="size-20 border border-white shadow-sm">
                <AvatarImage src={value.avatarUrl} alt={resolvedDisplayName} />
                <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">{getInitial(resolvedDisplayName)}</AvatarFallback>
              </Avatar>
              <div className="mt-3 text-sm font-medium text-foreground">{resolvedDisplayName}</div>
              {email && <div className="mt-1 max-w-full truncate text-xs text-muted-foreground">{email}</div>}
            </div>

            <label
              htmlFor={`${id}-avatar-file`}
              className={cn(
                "mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-3 py-3 text-center transition-colors",
                avatarDragActive ? "border-primary/40 bg-primary/10" : "border-border bg-background hover:border-primary/30 hover:bg-muted/50",
              )}
              onDragEnter={(event) => {
                event.preventDefault();
                setAvatarDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setAvatarDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setAvatarDragActive(false);
                openAvatarEditor(event.dataTransfer.files?.[0]);
              }}
            >
              <ImagePlus className="size-5 text-primary" />
              <span className="mt-2 text-xs font-medium text-muted-foreground">上传并裁剪头像</span>
              <span className="mt-1 text-[11px] leading-4 text-muted-foreground">支持拖入 PNG、JPG、WebP</span>
            </label>
            <input
              id={`${id}-avatar-file`}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                openAvatarEditor(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {avatarError && <div className="mt-2 text-xs leading-5 text-red-600">{avatarError}</div>}
          </div>

          <div className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-display-name`}>显示名称</Label>
                <Input
                  id={`${id}-display-name`}
                  value={value.displayName}
                  disabled={saving}
                  onChange={(event) => updateField("displayName", event.target.value)}
                  placeholder="你的姓名或常用称呼"
                  className="h-10 border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-location`}>所在地</Label>
                <Input
                  id={`${id}-location`}
                  value={value.location}
                  disabled={saving}
                  onChange={(event) => updateField("location", event.target.value)}
                  placeholder="城市或地区"
                  className="h-10 border-border"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-website`}>个人网站</Label>
              <Input
                id={`${id}-website`}
                value={value.website}
                disabled={saving}
                onChange={(event) => updateField("website", event.target.value)}
                placeholder="https://"
                className="h-10 border-border"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${id}-bio`}>个人简介</Label>
              <Textarea
                id={`${id}-bio`}
                value={value.bio}
                disabled={saving}
                onChange={(event) => updateField("bio", event.target.value)}
                placeholder="简单说明你的身份、团队或使用InternShannon OS的目的"
                className="min-h-24 resize-none border-border"
              />
            </div>

            <div className="flex justify-end gap-2 border-t border-border-light pt-4">
              {onCancel && (
                <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>{cancelLabel}</Button>
              )}
              <Button type="submit" className="min-w-32" disabled={saving}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                {saving ? savingLabel : submitLabel}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <Dialog open={avatarEditorOpen} onOpenChange={setAvatarEditorOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>编辑头像</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-[340px_1fr]">
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-muted/50 p-4">
                <canvas
                  ref={avatarCanvasRef}
                  className="mx-auto size-[320px] max-w-full cursor-grab rounded-md bg-background shadow-sm active:cursor-grabbing"
                  onPointerDown={handleAvatarPointerDown}
                  onPointerMove={handleAvatarPointerMove}
                  onPointerUp={handleAvatarPointerEnd}
                  onPointerCancel={handleAvatarPointerEnd}
                />
              </div>
              <div className="truncate text-xs text-muted-foreground">{avatarFileName || "头像图片"}</div>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border border-border-light bg-background p-4">
                <div className="text-sm font-semibold text-foreground">预览</div>
                <div className="mt-4 flex items-end gap-4">
                  <canvas ref={avatarPreviewCanvasRef} className="size-24 rounded-full border border-border-light bg-muted/50" />
                  <Avatar className="size-12 border border-border-light">
                    <AvatarImage src={value.avatarUrl} alt={resolvedDisplayName} />
                    <AvatarFallback className="bg-primary/10 text-primary">{getInitial(resolvedDisplayName)}</AvatarFallback>
                  </Avatar>
                </div>
                <div className="mt-3 text-xs leading-5 text-muted-foreground">
                  拖动图片调整位置，圆形区域就是最终头像展示范围。
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><ZoomIn className="size-3.5" /> 缩放</span>
                  <span>{avatarScale.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={avatarScale}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setAvatarScale(next);
                    const image = avatarImageRef.current;
                    if (image) setAvatarOffset((current) => clampAvatarOffset(image, current, next));
                  }}
                  className="w-full accent-primary"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAvatarEditorOpen(false)}>取消</Button>
            <Button type="button" onClick={applyCroppedAvatar}>
              <Upload className="size-4" />
              设置新头像
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function getInitial(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "U";
}

function getAvatarDrawRect(image: HTMLImageElement, size: number, scaleValue: number, offsetValue: { x: number; y: number }) {
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

function drawAvatarPreview(
  previewCanvas: HTMLCanvasElement | null,
  image: HTMLImageElement,
  scaleValue: number,
  offsetValue: { x: number; y: number },
) {
  const context = previewCanvas?.getContext("2d");
  if (!previewCanvas || !context || !image.naturalWidth || !image.naturalHeight) return;
  const previewSize = 96;
  const offsetScale = previewSize / AVATAR_CANVAS_SIZE;
  previewCanvas.width = previewSize;
  previewCanvas.height = previewSize;
  const draw = getAvatarDrawRect(image, previewSize, scaleValue, {
    x: offsetValue.x * offsetScale,
    y: offsetValue.y * offsetScale,
  });

  context.clearRect(0, 0, previewSize, previewSize);
  context.save();
  context.beginPath();
  context.arc(previewSize / 2, previewSize / 2, previewSize / 2, 0, Math.PI * 2);
  context.clip();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, previewSize, previewSize);
  context.drawImage(image, draw.dx, draw.dy, draw.dw, draw.dh);
  context.restore();
}

function clampAvatarOffset(image: HTMLImageElement, offset: { x: number; y: number }, scaleValue: number) {
  const baseScale = Math.max(AVATAR_CANVAS_SIZE / image.naturalWidth, AVATAR_CANVAS_SIZE / image.naturalHeight);
  const dw = image.naturalWidth * baseScale * scaleValue;
  const dh = image.naturalHeight * baseScale * scaleValue;
  const boundX = Math.max(0, (dw - AVATAR_CANVAS_SIZE) / 2);
  const boundY = Math.max(0, (dh - AVATAR_CANVAS_SIZE) / 2);
  return {
    x: Math.max(-boundX, Math.min(boundX, offset.x)),
    y: Math.max(-boundY, Math.min(boundY, offset.y)),
  };
}
