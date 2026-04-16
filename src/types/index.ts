export type Role = "viewer" | "editor" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  tenantId: string;
  role: Role;
}

export interface TenantUser {
  _id: string;
  name: string;
  email: string;
  tenantId: string;
  role: Role;
}

export interface PlaybackVariants {
  original?: string;
  hd720?: string;
  sd480?: string;
}

export interface Video {
  _id: string;
  ownerId?: string;
  accessScope?: "restricted" | "tenant";
  assignedViewerIds?: string[];
  title: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  cloudinarySecureUrl?: string;
  playbackVariants?: PlaybackVariants;
  processingStatus: "uploaded" | "processing" | "processed" | "failed";
  processingProgress: number;
  sensitivityStatus: "pending" | "safe" | "flagged";
  category: string;
  durationSeconds?: number;
  createdAt: string;
}
