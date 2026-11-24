export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      documents: {
        Row: {
          id: string;
          user_session: string;
          name: string;
          page_count: number;
          thumbnail_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_session: string;
          name: string;
          page_count: number;
          thumbnail_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          page_count?: number;
          thumbnail_url?: string | null;
          updated_at?: string;
        };
      };
      document_pages: {
        Row: {
          id: string;
          document_id: string;
          page_index: number;
          image_url: string;
          filter: string;
          rotation: number;
          width: number;
          height: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          page_index: number;
          image_url: string;
          filter: string;
          rotation: number;
          width: number;
          height: number;
          created_at?: string;
        };
        Update: {
          page_index?: number;
          image_url?: string;
          filter?: string;
          rotation?: number;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
