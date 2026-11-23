export type GalleryItem = {
  id: string;
  thumbUrl: string;
  width: number;
  height: number;
  name: string | null;
  createdAt: string;
  mime?: string;
  status?: string;
};

export type Stats = {
  total: number;
  visible: number;
  hidden: number;
  last24: number;
};
