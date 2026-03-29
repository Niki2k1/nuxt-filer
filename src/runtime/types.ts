export interface FileMeta {
  name: string;
  mime: string;
  type: string;
  version: number;
  username?: string;
  comment?: string;
  [key: string]: unknown;
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
