export const PROFILE_POLICY = {
  course: { minLength: 2, maxLength: 120 },
  semester: { min: 1, max: 99 },
  bio: { minLength: 1, maxLength: 200 },
  tags: { min: 3, max: 10, minLength: 2, maxLength: 30 },
};

export const profileSelect = {
  id: true,
  fullName: true,
  institutionalEmail: true,
  status: true,
  createdAt: true,
  course: true,
  semester: true,
  bio: true,
  tags: true,
  profileCompletedAt: true,
  roles: { select: { role: { select: { name: true } } } },
} as const;
