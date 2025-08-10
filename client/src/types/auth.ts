export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  profileImageUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}