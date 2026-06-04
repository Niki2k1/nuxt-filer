export interface FileMeta {
  name: string;
  mime: string;
  type: string;
  version: number;
  username?: string;
  comment?: string;
  [key: string]: unknown;
}

/** Output image format for {@link transformImage}. */
export type ImageFormat = 'webp' | 'png' | 'jpeg' | 'avif' | 'gif';

/**
 * Options for upload-time image processing, backed by the optional `sharp`
 * peer dependency. Passed via `useFileStorage().upload(.., { transform })` or
 * to the standalone `transformImage()` util.
 */
export interface ImageTransformOptions {
  /** Target width in px. Combined with `fit` to bound the image. */
  width?: number;
  /** Target height in px. Combined with `fit` to bound the image. */
  height?: number;
  /**
   * How the image is resized to fit `width`/`height`. Mirrors sharp's `fit`.
   * Default: `'inside'` (preserve aspect ratio, fit within the box).
   */
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  /** Never scale the image up beyond its original size. Default: `true`. */
  withoutEnlargement?: boolean;
  /** Output format. Default: keep the input's format. */
  format?: ImageFormat;
  /** Output quality (1-100) for lossy formats (webp/jpeg/avif). */
  quality?: number;
  /**
   * Preserve every frame of multi-frame inputs (animated webp/gif). Default:
   * `true`; harmless for static images. Animation is only retained when the
   * output `format` is animation-capable (`webp`/`gif`).
   */
  animated?: boolean;
  /** Background used when flattening transparency (e.g. for `contain`/jpeg). */
  background?: string;
}

/** Result of {@link transformImage}: the processed bytes plus resolved metadata. */
export interface ImageTransformResult {
  /** The processed image bytes. */
  data: Buffer;
  /** MIME type of the processed image, e.g. `image/webp`. */
  mime: string;
  /** Resolved output format, e.g. `webp`. */
  format: string;
  /** Width of the processed image in px, if sharp could determine it. */
  width?: number;
  /** Height of the processed image in px, if sharp could determine it. */
  height?: number;
}

export interface ExternalRef {
  /** External system identifier, e.g. 'jira', 'sharepoint' */
  source: string;
  /** ID of the file in the external system */
  externalId: string;
  /** URL to the file in the external system */
  externalUrl?: string;
  /** When metadata/thumbnail was last synced */
  cachedAt?: Date;
}

export interface StoredFile {
  id: string;
  groupId: string;
  data?: Buffer;
  meta: FileMeta;
  external?: ExternalRef;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FileStorageExternalProvider {
  /** Sync local cache with the external system (pull latest metadata/thumbnail) */
  sync(groupId: string, id: string): Promise<void>;
  /** Push local file data and metadata to the external system */
  push(
    groupId: string,
    id: string,
    data: Buffer,
    meta: FileMeta
  ): Promise<void>;
  /** Pull a file from the external system into local storage */
  pull(groupId: string, externalRef: ExternalRef): Promise<StoredFile>;
}

export interface FileStorageProvider {
  create(
    groupId: string,
    data: Buffer | Uint8Array,
    meta?: FileMeta
  ): Promise<{ id: string }>;
  get(groupId: string, id: string): Promise<StoredFile | null>;
  getData(groupId: string, id: string): Promise<Buffer | null>;
  getMeta(id: string): Promise<FileMeta | null>;
  list(groupId: string): Promise<StoredFile[]>;
  update(id: string, meta: Partial<FileMeta>): Promise<void>;
  remove(groupId: string, id: string): Promise<void>;
  clear(groupId: string): Promise<void>;
  has(groupId: string, id: string): Promise<boolean>;
  findByMeta(filter: {
    key: string;
    value: unknown;
    groupId?: string;
  }): Promise<StoredFile | null>;

  /** Optional external file sync support */
  external?: FileStorageExternalProvider;
}
