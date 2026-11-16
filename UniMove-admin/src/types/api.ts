import type { AdminPermission } from "./admin-iam"

// Reexportado para quem já importa de "types/api" não precisar de dois caminhos.
export type { AdminPermission }

export type UserStatus = "ACTIVE" | "SUSPENDED" | "BLOCKED" | "DEACTIVATED"
export type RoleName = "PASSENGER" | "DRIVER" | "ADMIN"
export type VerificationStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED"
export type RideStatus =
  | "SCHEDULED"
  | "OPEN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
export type RideRequestStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED"
export type ReservationStatus =
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW"
export type IncidentStatus =
  | "OPEN"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "DISMISSED"
export type IncidentType =
  | "INAPPROPRIATE_BEHAVIOR"
  | "NO_SHOW"
  | "VEHICLE_ISSUE"
  | "SAFETY_CONCERN"
  | "OTHER"
export type ReportType = "users" | "rides" | "verifications" | "incidents"

export type Person = { id: string; fullName: string }

export type ListResult<T> = {
  items: T[]
  total: number
  statusCounts: Record<string, number>
}

export type SessionUser = {
  id: string
  fullName: string
  email: string
  roles: RoleName[]
  /**
   * Permissões administrativas concedidas à conta. Servem para a interface
   * mostrar só o que ela pode fazer; a decisão de verdade é do servidor, em
   * AdminPermissionsGuard. Conta sem linha de permissões vem com lista vazia.
   */
  permissions: AdminPermission[]
  twoFactorEnabled: boolean
  recoveryCodesRemaining?: number
}

/**
 * Só existe uma continuação possível: o segundo fator. O autenticador do
 * administrador é provisionado por um operador em terminal privado, nunca por
 * HTTP — conta sem fator ativo recebe 403 ADMIN_ENROLLMENT_REQUIRED no login.
 */
export type LoginResult = { step: "TWO_FACTOR" }

export type SecondFactorResult = {
  user: SessionUser
  recoveryCodes?: string[]
  recoveryCodesRemaining?: number
}

export type DashboardSummary = {
  users: { total: number; active: number; drivers: number }
  rides: {
    open: number
    scheduled: number
    inProgress: number
    completed: number
    cancelled: number
  }
  verifications: { pending: number; pendingOver24h: number }
  incidents: { open: number; underReview: number }
  generatedAt: string
}

export type SeriesPoint = { date: string; users: number; rides: number }

export type AdminUserRow = {
  id: string
  fullName: string
  institutionalEmail: string
  course: string | null
  status: UserStatus
  createdAt: string
  deletedAt: string | null
  roles: RoleName[]
  verificationStatus: VerificationStatus | null
}

export type AuditEntry = {
  id: string
  action: string
  metadata: Record<string, unknown> | null
  createdAt: string
  actor: { id?: string; fullName: string } | null
}

export type AdminUserDetail = {
  id: string
  fullName: string
  institutionalEmail: string
  studentNumber: string | null
  course: string | null
  semester: number | null
  status: UserStatus
  createdAt: string
  deletedAt: string | null
  profileCompletedAt: string | null
  roles: RoleName[]
  academicVerification: {
    status: VerificationStatus
    submittedAt: string
    reviewedAt: string | null
    reviewNote: string | null
  } | null
  vehicles: {
    id: string
    brand: string
    model: string
    color: string
    year: number
    plate: string
  }[]
  counts: {
    drivenRides: number
    reservations: number
    incidentsReported: number
    incidentsAgainst: number
  }
  rating: { average: number | null; count: number }
  adminHistory: AuditEntry[]
}

export type UserImpact = {
  ridesInProgress: number
  futureRidesAsDriver: number
  passengersAffected: number
  reservationsAsPassenger: number
  pendingRequestsAsPassenger: number
}

export type StatusChangeResult = {
  id: string
  status: UserStatus
  consequences: {
    ridesCancelled: number
    reservationsCancelled: number
    requestsCancelled: number
  }
  notificationsDelivered: boolean
}

export type VerificationRow = {
  userId: string
  reportGuid: string
  status: VerificationStatus
  submittedAt: string
  reviewedAt: string | null
  reviewNote: string | null
  user: {
    fullName: string
    institutionalEmail: string
    studentNumber: string | null
    course: string | null
  }
  reviewedBy: { fullName: string } | null
}

export type RideRow = {
  id: string
  status: RideStatus
  departureAt: string
  totalSeats: number
  availableSeats: number
  pricePerPersonCents: number
  driver: Person
  originLocation: { name: string }
  destinationLocation: { name: string }
}

export type RideDetail = RideRow & {
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  additionalInfo: string | null
  vehicle: { brand: string; model: string; color: string; plate: string }
  requests: {
    id: string
    status: RideRequestStatus
    seatsRequested: number
    createdAt: string
    passenger: Person
  }[]
  reservations: {
    id: string
    status: ReservationStatus
    seats: number
    confirmedAt: string
    passenger: Person
  }[]
  cancellations: {
    id: string
    reason: string
    createdAt: string
    cancelledBy: Person
  }[]
  incidents: {
    id: string
    type: IncidentType
    status: IncidentStatus
    createdAt: string
  }[]
}

export type IncidentRow = {
  id: string
  rideId: string
  type: IncidentType
  status: IncidentStatus
  createdAt: string
  resolvedAt: string | null
  reportedBy: Person
  reportedUser: Person | null
}

export type IncidentDetail = Omit<IncidentRow, "rideId"> & {
  description: string
  ride: {
    id: string
    status: RideStatus
    departureAt: string
    driver: Person
    originLocation: { name: string }
    destinationLocation: { name: string }
  }
  decisions: AuditEntry[]
}

export type AuditLogRow = AuditEntry & {
  entityType: string
  entityId: string | null
}

export type ReportSummary = {
  days: number
  completionRate: number | null
  cancellationRate: number | null
  requestAcceptanceRate: number | null
  estimatedValueCents: number
  topOrigins: { name: string; rides: number }[]
  verifications: Partial<Record<VerificationStatus, number>>
  incidentsByType: Partial<Record<IncidentType, number>>
  series: SeriesPoint[]
}
