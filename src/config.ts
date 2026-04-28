import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");

export const CACHE_DIR = path.join(REPO_ROOT, ".cache");
export const DOCS_OUT_DIR = path.join(REPO_ROOT, "docs");

export type SourceRepo = {
  key: "flutter" | "backend";
  url: string;
  defaultRef: string;
  cacheDir: string;
};

export const SOURCES: Record<"flutter" | "backend", SourceRepo> = {
  flutter: {
    key: "flutter",
    url: "https://github.com/cmm-apps-flutter/EsmorgaFlutter.git",
    defaultRef: "main",
    cacheDir: path.join(CACHE_DIR, "EsmorgaFlutter"),
  },
  backend: {
    key: "backend",
    url: "https://github.com/Esmorga-Backend/esmorga-backend.git",
    defaultRef: "main",
    cacheDir: path.join(CACHE_DIR, "esmorga-backend"),
  },
};
