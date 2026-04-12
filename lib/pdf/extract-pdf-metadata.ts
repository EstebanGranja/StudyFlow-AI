export type PdfMetadata = {
  pageCount: number | null;
  fileSizeBytes: number;
};

const MAX_REASONABLE_PAGE_COUNT = 10000;

function normalizePageCount(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const normalized = Math.floor(value);
  if (normalized > MAX_REASONABLE_PAGE_COUNT) {
    return null;
  }

  return normalized;
}

function extractPageCountFromPageObjects(pdfText: string): number | null {
  const pageTypeMatches = pdfText.match(/\/Type\s*\/Page\b/g);

  if (!pageTypeMatches || pageTypeMatches.length === 0) {
    return null;
  }

  return normalizePageCount(pageTypeMatches.length);
}

function extractPageCountFromCountHints(pdfText: string): number | null {
  const countMatches = pdfText.matchAll(/\/Count\s+(\d{1,5})\b/g);

  let maxCount = 0;

  for (const match of countMatches) {
    const countText = match[1];
    if (!countText) {
      continue;
    }

    const parsed = Number.parseInt(countText, 10);
    if (!Number.isFinite(parsed)) {
      continue;
    }

    maxCount = Math.max(maxCount, parsed);
  }

  return normalizePageCount(maxCount);
}

export function extractPdfMetadata(pdfBuffer: Buffer): PdfMetadata {
  const fileSizeBytes = pdfBuffer.length;

  if (fileSizeBytes === 0) {
    return {
      pageCount: null,
      fileSizeBytes,
    };
  }

  // latin1 avoids decode errors on binary data while keeping token search simple.
  const pdfText = pdfBuffer.toString("latin1");

  const pageCountFromObjects = extractPageCountFromPageObjects(pdfText);
  if (pageCountFromObjects) {
    return {
      pageCount: pageCountFromObjects,
      fileSizeBytes,
    };
  }

  const pageCountFromHints = extractPageCountFromCountHints(pdfText);

  return {
    pageCount: pageCountFromHints,
    fileSizeBytes,
  };
}
