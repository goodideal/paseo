declare module "node:sqlite" {
  export type SQLInputValue = null | number | bigint | string | Uint8Array;
  export type SQLOutputValue = null | number | bigint | string | Uint8Array;

  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    all(...anonymousParameters: SQLInputValue[]): Array<Record<string, SQLOutputValue>>;
    all(
      namedParameters: Record<string, SQLInputValue>,
      ...anonymousParameters: SQLInputValue[]
    ): Array<Record<string, SQLOutputValue>>;
    get(...anonymousParameters: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
    get(
      namedParameters: Record<string, SQLInputValue>,
      ...anonymousParameters: SQLInputValue[]
    ): Record<string, SQLOutputValue> | undefined;
    run(...anonymousParameters: SQLInputValue[]): StatementResultingChanges;
    run(
      namedParameters: Record<string, SQLInputValue>,
      ...anonymousParameters: SQLInputValue[]
    ): StatementResultingChanges;
    expandedSQL: string;
    sourceSQL: string;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
    allowExtension?: boolean;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    open(): void;
    prepare(sql: string): StatementSync;
    readonly isOpen: boolean;
  }
}
