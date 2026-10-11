/** A place to put listing photos. */
export interface PhotoStore {
  readonly driver: "local" | "s3";
  /** Store the image and return a URL anyone can GET. */
  put(bytes: Uint8Array, contentType: string): Promise<string>;
}
