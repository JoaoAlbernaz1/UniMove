import type { Me } from '../api/auth';
import { mockProfileExtras, mockAchievements, mockReviews, mockStats } from '../mocks/profile';

export type Profile = Me & {
  isOwner: boolean;
  status?: string;
  createdAt?: string;
  course: string;
  semester: string;
  bio: string;
  avatarUrl: string | null;
  tags: string[];
};

export type ProfileStats = (typeof mockStats)[number];
export type Achievement = (typeof mockAchievements)[number];
export type ProfileReview = (typeof mockReviews)[number];
export type UpdateProfileInput = Pick<Profile, 'fullName' | 'bio' | 'tags'>;

let editableMocks = { ...mockProfileExtras, tags: [...mockProfileExtras.tags] };
type AuthApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function getProfile(authApi: AuthApi, userId: string): Promise<Profile> {
  const me = await authApi<Me & { status?: string; createdAt?: string }>('/users/me');
  if (me.id !== userId) {
    return { ...me, id: userId, isOwner: false, fullName: 'Usuário', institutionalEmail: '', ...editableMocks };
  }
  return { ...me, isOwner: true, ...editableMocks };
}

export async function updateProfile(authApi: AuthApi, input: UpdateProfileInput): Promise<Profile> {
  const updated = await authApi<Me>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify({ fullName: input.fullName }),
  });
  editableMocks = { ...editableMocks, bio: input.bio, tags: [...input.tags] };
  return { ...updated, isOwner: true, ...editableMocks };
}

export async function getProfileStats(): Promise<ProfileStats[]> { return [...mockStats]; }
export async function getProfileAchievements(): Promise<Achievement[]> { return [...mockAchievements]; }
export async function getProfileReviews(): Promise<ProfileReview[]> { return [...mockReviews]; }
