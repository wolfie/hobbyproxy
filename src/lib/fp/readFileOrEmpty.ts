import type { Abortable } from "events";
import type { ObjectEncodingOptions, OpenMode, PathLike } from "fs";
import { type FileHandle, readFile } from "fs/promises";
import isEnoent from "./isEnoent.ts";

function readFileOrUndefined(
  path: PathLike | FileHandle,
  options?:
    | ({ encoding?: null | undefined; flag?: OpenMode | undefined } & Abortable)
    | null
): Promise<Buffer | undefined>;
function readFileOrUndefined(
  path: PathLike | FileHandle,
  options:
    | ({ encoding: BufferEncoding; flag?: OpenMode | undefined } & Abortable)
    | BufferEncoding
): Promise<string | undefined>;
function readFileOrUndefined(
  path: PathLike | FileHandle,
  options?:
    | (ObjectEncodingOptions & Abortable & { flag?: OpenMode | undefined })
    | BufferEncoding
    | null
): Promise<string | Buffer | undefined>;
async function readFileOrUndefined(...args: Parameters<typeof readFile>) {
  try {
    return await readFile(...args);
  } catch (e) {
    if (isEnoent(e)) return undefined;
    else throw e;
  }
}

export default readFileOrUndefined;
