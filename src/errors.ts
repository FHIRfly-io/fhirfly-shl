// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Base error class for all SHL SDK errors.
 */
export class ShlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShlError";
    Object.setPrototypeOf(this, ShlError.prototype);
  }
}

/**
 * Error thrown when IPS bundle validation fails.
 */
export class ValidationError extends ShlError {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error thrown when a storage operation fails.
 */
export class StorageError extends ShlError {
  readonly operation: string;

  constructor(message: string, operation: string) {
    super(message);
    this.name = "StorageError";
    this.operation = operation;
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

/**
 * Error thrown when encryption or decryption fails.
 */
export class EncryptionError extends ShlError {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
    Object.setPrototypeOf(this, EncryptionError.prototype);
  }
}
