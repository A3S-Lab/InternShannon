import { type ButtonHTMLAttributes, type MouseEvent, useState } from "react";
import { toast } from "sonner";
import { tv, type VariantProps } from "tailwind-variants";
import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AvatarUploader } from "@/desktop/components/avatar-uploader";
import { fileToDataUrl } from "@/desktop/lib/image";
import globalModel from "@/models/global.model";
import { resolveProfileButtonLabel } from "./user-profile-trigger-state";

const UserVariants = tv({
  base: "inline-flex cursor-pointer items-center justify-center overflow-hidden rounded-md border-0 bg-transparent p-0 text-inherit outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
  variants: {
    size: {
      default: "size-8",
      sm: "size-6",
      lg: "size-10",
      xl: "size-12",
      "2xl": "size-14",
      "3xl": "size-16",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export interface UserProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof UserVariants> {}

const User = ({ className, size, onClick, type = "button", title, "aria-label": ariaLabel, ...props }: UserProps) => {
  const cls = UserVariants({ className, size });
  const { user } = useSnapshot(globalModel.state);
  const [open, setOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const profileButtonLabel = resolveProfileButtonLabel(user.nickname);

  const handleOpen = (e: MouseEvent<HTMLButtonElement>) => {
    setNickname(user.nickname);
    setAvatarUrl(user.avatar);
    setOpen(true);
    onClick?.(e);
  };

  const handleSave = () => {
    globalModel.setProfile(nickname.trim() || user.nickname, avatarUrl);
    setOpen(false);
    toast.success("资料已保存");
  };

  return (
    <>
      <button
        className={cls}
        type={type}
        onClick={handleOpen}
        aria-label={ariaLabel ?? profileButtonLabel}
        title={title ?? profileButtonLabel}
        {...props}
      >
        <img src={user.avatar} alt={user.nickname} className="w-full h-full rounded-md object-cover" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>个人资料</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 pt-1">
            <AvatarUploader className="size-20" value={avatarUrl} onChange={setAvatarUrl} onUpload={fileToDataUrl} />
            <div className="w-full space-y-1.5">
              <label htmlFor="profile-nickname" className="text-sm font-medium">
                昵称
              </label>
              <Input
                id="profile-nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                placeholder="你的昵称"
                maxLength={20}
              />
            </div>
            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button className="flex-1" onClick={handleSave}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
User.displayName = "User";

export { User, UserVariants };
