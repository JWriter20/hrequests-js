/**
 * Toolbelt utilities for hrequests-js
 * Mirrors the Python hrequests toolbelt
 */

import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { Readable } from 'node:stream';

/**
 * A case-insensitive dictionary for HTTP headers
 * Origin: requests library (https://github.com/psf/requests)
 */
export class CaseInsensitiveDict implements Map<string, string> {
  private _store: Map<string, [string, string]> = new Map();

  constructor(data?: Record<string, string> | Map<string, string> | CaseInsensitiveDict | Iterable<[string, string]>) {
    if (data) {
      if (data instanceof CaseInsensitiveDict) {
        for (const [key, value] of data.entries()) {
          this.set(key, value);
        }
      } else if (data instanceof Map) {
        for (const [key, value] of data.entries()) {
          this.set(key, value);
        }
      } else if (Symbol.iterator in Object(data)) {
        for (const [key, value] of data as Iterable<[string, string]>) {
          this.set(key, value);
        }
      } else {
        for (const [key, value] of Object.entries(data as Record<string, string>)) {
          this.set(key, value);
        }
      }
    }
  }

  get(key: string): string | undefined {
    const entry = this._store.get(key.toLowerCase());
    return entry ? entry[1] : undefined;
  }

  set(key: string, value: string): this {
    this._store.set(key.toLowerCase(), [key, value]);
    return this;
  }

  has(key: string): boolean {
    return this._store.has(key.toLowerCase());
  }

  delete(key: string): boolean {
    return this._store.delete(key.toLowerCase());
  }

  clear(): void {
    this._store.clear();
  }

  get size(): number {
    return this._store.size;
  }

  forEach(callbackfn: (value: string, key: string, map: Map<string, string>) => void, thisArg?: unknown): void {
    for (const [casedKey, mappedValue] of this._store.values()) {
      callbackfn.call(thisArg, mappedValue, casedKey, this);
    }
  }

  *keys(): IterableIterator<string> {
    for (const [casedKey] of this._store.values()) {
      yield casedKey;
    }
  }

  *values(): IterableIterator<string> {
    for (const [, mappedValue] of this._store.values()) {
      yield mappedValue;
    }
  }

  *entries(): IterableIterator<[string, string]> {
    for (const [casedKey, mappedValue] of this._store.values()) {
      yield [casedKey, mappedValue];
    }
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }

  get [Symbol.toStringTag](): string {
    return 'CaseInsensitiveDict';
  }

  /** Like entries(), but with all lowercase keys */
  *lowerItems(): IterableIterator<[string, string]> {
    for (const [lowerKey, [, value]] of this._store.entries()) {
      yield [lowerKey, value];
    }
  }

  /** Create a copy of this dict */
  copy(): CaseInsensitiveDict {
    return new CaseInsensitiveDict(this);
  }

  /** Convert to a plain object */
  toObject(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, value] of this.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  /** Update from another dict or object */
  update(other: Record<string, string> | CaseInsensitiveDict | Map<string, string>): void {
    if (other instanceof CaseInsensitiveDict || other instanceof Map) {
      for (const [key, value] of other.entries()) {
        this.set(key, value);
      }
    } else {
      for (const [key, value] of Object.entries(other)) {
        this.set(key, value);
      }
    }
  }

  toString(): string {
    return JSON.stringify(this.toObject());
  }
}

export interface FileData {
  fileName: string;
  data: Buffer | string;
  contentType?: string;
  customHeaders?: Record<string, string>;
}

/**
 * File utilities for multipart form data
 */
export class FileUtils {
  /**
   * Convert a value to a list of items
   */
  static toItemsList<T>(value: Record<string, T> | [string, T][]): [string, T][] {
    if (Array.isArray(value)) {
      return value;
    }
    return Object.entries(value);
  }

  /**
   * Tries to guess the filename of the given object
   */
  static guessFilename(obj: unknown): string | undefined {
    if (obj && typeof obj === 'object' && 'name' in obj) {
      const name = (obj as { name: string }).name;
      if (typeof name === 'string' && !name.startsWith('<') && !name.endsWith('>')) {
        return basename(name);
      }
    }
    return undefined;
  }

  /**
   * Get fields from data for multipart encoding
   */
  static *getFields(data: Record<string, unknown> | [string, unknown][]): Generator<[string, string | Buffer]> {
    const fields = FileUtils.toItemsList(data);
    for (const [field, val] of fields) {
      const values = Array.isArray(val) ? val : [val];
      for (const v of values) {
        if (v === null || v === undefined) continue;

        let processedValue: string | Buffer;
        if (Buffer.isBuffer(v)) {
          processedValue = v;
        } else if (typeof v === 'string') {
          processedValue = v;
        } else {
          processedValue = String(v);
        }

        yield [field, processedValue];
      }
    }
  }

  /**
   * Build the body for a multipart/form-data request
   */
  static encodeFiles(
    files: Record<string, FileInput>,
    data?: Record<string, unknown>
  ): { body: Buffer; contentType: string } {
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;
    const parts: Buffer[] = [];

    // Add data fields first
    if (data) {
      for (const [field, value] of FileUtils.getFields(data)) {
        parts.push(Buffer.from(`--${boundary}\r\n`));
        parts.push(Buffer.from(`Content-Disposition: form-data; name="${field}"\r\n\r\n`));
        parts.push(Buffer.isBuffer(value) ? value : Buffer.from(value));
        parts.push(Buffer.from('\r\n'));
      }
    }

    // Add file fields
    for (const [fieldName, fileInput] of Object.entries(files)) {
      const file = FileUtils.normalizeFileInput(fieldName, fileInput);

      parts.push(Buffer.from(`--${boundary}\r\n`));

      let disposition = `Content-Disposition: form-data; name="${fieldName}"`;
      if (file.fileName) {
        disposition += `; filename="${file.fileName}"`;
      }
      parts.push(Buffer.from(disposition + '\r\n'));

      if (file.contentType) {
        parts.push(Buffer.from(`Content-Type: ${file.contentType}\r\n`));
      }

      if (file.customHeaders) {
        for (const [headerName, headerValue] of Object.entries(file.customHeaders)) {
          parts.push(Buffer.from(`${headerName}: ${headerValue}\r\n`));
        }
      }

      parts.push(Buffer.from('\r\n'));
      parts.push(Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data));
      parts.push(Buffer.from('\r\n'));
    }

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    return {
      body: Buffer.concat(parts),
      contentType: `multipart/form-data; boundary=${boundary}`
    };
  }

  /**
   * Normalize various file input formats to FileData
   */
  private static normalizeFileInput(fieldName: string, input: FileInput): FileData {
    // Tuple format: [filename, data, contentType?, headers?]
    if (Array.isArray(input)) {
      const [fileName, data, contentType, customHeaders] = input;
      return {
        fileName,
        data: Buffer.isBuffer(data) ? data : Buffer.from(data),
        contentType,
        customHeaders
      };
    }

    // Buffer or string
    if (Buffer.isBuffer(input) || typeof input === 'string') {
      return {
        fileName: fieldName,
        data: Buffer.isBuffer(input) ? input : Buffer.from(input)
      };
    }

    // Object with path (file path)
    if (typeof input === 'object' && 'path' in input) {
      const filePath = input.path as string;
      const data = require('fs').readFileSync(filePath);
      return {
        fileName: basename(filePath),
        data,
        contentType: input.contentType as string | undefined
      };
    }

    // FileData object
    return input as FileData;
  }
}

export type FileInput =
  | Buffer
  | string
  | [string, Buffer | string, string?, Record<string, string>?]
  | { path: string; contentType?: string }
  | FileData;

