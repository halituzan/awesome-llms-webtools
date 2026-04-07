import archiver from "archiver";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import type { GeneratedBundleFiles } from "./generateBundle.js";

export async function zipBundleFiles(files: GeneratedBundleFiles): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(sink);

  for (const [name, content] of Object.entries(files)) {
    archive.append(content, { name });
  }

  await archive.finalize();
  await finished(sink);
  return Buffer.concat(chunks);
}
