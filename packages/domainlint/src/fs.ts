import { readFile, stat } from 'node:fs/promises';

export interface FileSystem {
  readFile(path: string, encoding: 'utf-8'): Promise<string>;
  stat(path: string): Promise<{ isFile(): boolean }>;
}

export const nodeFileSystem: FileSystem = {
  readFile: (path, encoding) => readFile(path, encoding),
  stat,
};
