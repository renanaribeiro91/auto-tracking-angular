export interface WorkspaceEntry {
  readonly name: string;
  readonly directory: boolean;
}

export interface WorkspaceFileSystem {
  exists(file: string): boolean;
  readText(file: string): string;
  readBytes(file: string): Uint8Array;
  readDirectory(directory: string): readonly WorkspaceEntry[];
}
