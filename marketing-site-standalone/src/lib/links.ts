// The marketing site lives at irrigopro.com; the IrrigoPro app lives at
// app.irrigopro.com. All links to the app must be absolute.
const APP_BASE =
  (import.meta.env.VITE_APP_BASE_URL as string | undefined) ??
  "https://app.irrigopro.com";

export const APP_URL = APP_BASE;
export const APP_LOGIN_URL = `${APP_BASE.replace(/\/$/, "")}/login`;
