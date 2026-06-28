import { QRCodeSVG } from "qrcode.react";
import * as React from "react";

export interface QRCodeProps {
	value: string;
	size?: number;
	level?: "L" | "M" | "Q" | "H";
	className?: string;
	src?: string;
	alt?: string;
	bgColor?: string;
	fgColor?: string;
	onError?: (error: string) => void;
}

function QRCode({
	value,
	size = 180,
	level = "M",
	className,
	src,
	alt = "QR Code",
	bgColor = "#ffffff",
	fgColor = "#000000",
	onError,
}: QRCodeProps) {
	const [imageFailed, setImageFailed] = React.useState(false);

	React.useEffect(() => {
		setImageFailed(false);
	}, [src]);

	const handleImageError = () => {
		setImageFailed(true);
		onError?.("Failed to load QR code image");
	};

	if (src && !imageFailed) {
		return (
			<img
				src={src}
				alt={alt}
				width={size}
				height={size}
				className={className}
				onError={handleImageError}
			/>
		);
	}

	return (
		<QRCodeSVG
			value={value}
			size={size}
			level={level}
			className={className}
			bgColor={bgColor}
			fgColor={fgColor}
		/>
	);
}

export { QRCode };
