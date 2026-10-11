/** Values remain lossless JSON: Int64/UInt64 and Decimal arrive as strings. */
export type Json =
    | null
    | boolean
    | number
    | string
    | Json[]
    | {
          [key: string]: Json;
      };

export type Row = Json[];

export interface Column {
    name: string;
    type: string;
}
