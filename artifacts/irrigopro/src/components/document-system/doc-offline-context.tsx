import { createContext, useContext } from "react";
export const DocOfflineContext = createContext({ fromCopy: false, savedAt: 0, siteKey: "", online: true, queuedCount: 0, failedCount: 0 });
export const useDocOffline = () => useContext(DocOfflineContext);
