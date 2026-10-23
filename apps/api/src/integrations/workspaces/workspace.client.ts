export interface WorkspaceEntry {
  // Path from the top of the workspace, with "/" between folders.
  path: string;
  type: 'file' | 'folder';
  // Size in bytes, for files.
  bytes: number | null;
}

export interface WorkspaceListing {
  entries: WorkspaceEntry[];
  // True when there were more entries than the limit.
  truncated: boolean;
}

export interface WorkspaceFile {
  content: string;
  bytes: number;
  // True when the file was longer than the read limit and was cut off.
  truncated: boolean;
}

// Each task gets its own folder of files, its workspace. Paths are always relative to that
// folder, and nothing outside it can be read or written. The folder is made on the first write.
export interface WorkspaceClient {
  list(taskId: string, folder?: string): Promise<WorkspaceListing>;
  read(taskId: string, path: string): Promise<WorkspaceFile>;
  write(taskId: string, path: string, content: string): Promise<{ bytes: number }>;
}
