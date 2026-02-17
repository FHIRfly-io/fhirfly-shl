import QRCode from "qrcode";

/**
 * Generate a QR code PNG as a data URI from a URL string.
 *
 * Uses error correction level L (7%) which is sufficient for
 * machine-scanned SHL URLs.
 */
export async function generateQRCode(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "L",
    margin: 2,
  });
}
