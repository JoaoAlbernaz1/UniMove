import { useState } from "react"
import { ChevronRight, Flag, LockKeyhole } from "lucide-react"
import { ListView, type Column } from "../components/DataTable"
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageIntro,
  RouteStops,
  SearchInput,
  StatusFilter,
} from "../components/ui"
import { DateRangeFilter, dayRangeToApi } from "../components/DateRangeFilter"
import { useQuery } from "../hooks/useQuery"
import { DAY_FORMAT, useSearchField, useUrlFilters } from "../hooks/useUrlFilters"
import {
  countOf,
  formatDateTime,
  formatMoney,
  initialsOf,
  shortId,
} from "../lib/format"
import {
  incidentStatusLabel,
  incidentTypeLabel,
  requestStatusLabel,
  reservationStatusLabel,
  rideStatusLabel,
} from "../lib/labels"
import { ridesApi } from "../services/adminApi"
import type { RideRow, RideStatus } from "../types/api"

const STATS: { status: RideStatus; label: string }[] = [
  { status: "OPEN", label: "Abertas" },
  { status: "SCHEDULED", label: "Agendadas" },
  { status: "IN_PROGRESS", label: "Em andamento" },
  { status: "COMPLETED", label: "Concluídas" },
  { status: "CANCELLED", label: "Canceladas" },
]

const FILTERS = {
  q: null,
  status: STATS.map((stat) => stat.status),
  from: DAY_FORMAT,
  to: DAY_FORMAT,
}

export default function RidesPage() {
  const { values, page, setFilters, setPage, clearFilters } =
    useUrlFilters(FILTERS)
  const [query, setQuery] = useSearchField(values.q, (q) => setFilters({ q }))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filtered = Boolean(values.q || values.status || values.from || values.to)

  const rides = useQuery(
    () =>
      ridesApi.list({
        q: values.q,
        status: values.status,
        page,
        ...dayRangeToApi(values),
      }),
    [values.q, values.status, values.from, values.to, page],
  )
  const counts = rides.data?.statusCounts ?? {}

  const columns: Column<RideRow>[] = [
    {
      key: "route",
      header: "Trajeto",
      primary: true,
      wrap: true,
      cell: (ride) => (
        <button
          type="button"
          className="route"
          onClick={() => setSelectedId(ride.id)}
        >
          <RouteStops
            origin={ride.originLocation.name}
            destination={ride.destinationLocation.name}
          />
        </button>
      ),
    },
    {
      key: "driver",
      header: "Motorista",
      wrap: true,
      cell: (ride) => (
        <span className="person-cell">
          <Avatar initials={initialsOf(ride.driver.fullName)} size="sm" />
          <span>{ride.driver.fullName}</span>
        </span>
      ),
    },
    {
      key: "departure",
      header: "Saída",
      cell: (ride) => formatDateTime(ride.departureAt),
    },
    {
      key: "seats",
      header: "Vagas livres",
      cell: (ride) => `${ride.availableSeats} de ${ride.totalSeats}`,
    },
    {
      key: "price",
      header: "Valor anunciado",
      cell: (ride) => (
        <span className="numeric">{formatMoney(ride.pricePerPersonCents)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (ride) => <Badge>{rideStatusLabel[ride.status]}</Badge>,
    },
    {
      key: "open",
      header: "Abrir",
      action: true,
      cell: (ride) => (
        <button
          type="button"
          className="icon-button"
          onClick={() => setSelectedId(ride.id)}
          aria-label={`Ver carona ${shortId(ride.id)}`}
        >
          <ChevronRight size={16} />
        </button>
      ),
    },
  ]

  return (
    <>
      <PageIntro
        title="Gestão de caronas"
        description="Consulte viagens publicadas, reservas e solicitações."
      />
      <section className="panel">
        <StatusFilter
          label="Filtrar por status"
          value={values.status}
          onChange={(status) => setFilters({ status })}
          loaded={Boolean(rides.data)}
          options={[
            { value: "", label: "Todas" },
            ...STATS.map((stat) => ({
              value: stat.status,
              label: stat.label,
              count: counts[stat.status] ?? 0,
            })),
          ]}
        />
        <div className="table-toolbar">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar motorista, origem ou destino"
          />
          <span className="toolbar-spacer" />
          <DateRangeFilter
            value={values}
            onChange={({ from = "", to = "" }) => setFilters({ from, to })}
          />
        </div>
        <ListView
          query={rides}
          label="Caronas"
          columns={columns}
          rowKey={(ride) => ride.id}
          empty={<EmptyState filtered={filtered} onClear={clearFilters} />}
          page={page}
          onPageChange={setPage}
          countLabel={(total) =>
            countOf(total, "carona encontrada", "caronas encontradas")
          }
        />
      </section>
      {selectedId && (
        <RideDetails id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </>
  )
}

function RideDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useQuery(() => ridesApi.detail(id), [id])
  const ride = detail.data
  return (
    <Modal
      title={`Detalhes da carona ${shortId(id)}`}
      description="Dados operacionais da viagem"
      onClose={onClose}
      width="lg"
    >
      {detail.error ? (
        <ErrorState error={detail.error} onRetry={detail.reload} />
      ) : !ride ? (
        <Loading />
      ) : (
        <>
          <div className="profile-hero">
            <div>
              <span className="route">
                <RouteStops
                  origin={ride.originLocation.name}
                  destination={ride.destinationLocation.name}
                />
              </span>
            </div>
            <span className="toolbar-spacer" />
            <Badge>{rideStatusLabel[ride.status]}</Badge>
          </div>
          <div className="modal-body detail-content">
            <dl className="detail-list">
              <div>
                <dt>Motorista</dt>
                <dd>{ride.driver.fullName}</dd>
              </div>
              <div>
                <dt>Saída</dt>
                <dd>{formatDateTime(ride.departureAt)}</dd>
              </div>
              <div>
                <dt>Vagas livres</dt>
                <dd>
                  {ride.availableSeats} de {ride.totalSeats}
                </dd>
              </div>
              <div>
                <dt>Veículo</dt>
                <dd>
                  {ride.vehicle.brand} {ride.vehicle.model}, placa{" "}
                  {ride.vehicle.plate}
                </dd>
              </div>
              <div>
                <dt>Valor anunciado por pessoa</dt>
                <dd>{formatMoney(ride.pricePerPersonCents)}</dd>
              </div>
            </dl>
            <div className="detail-grid">
              <section>
                <h4>Reservas ({ride.reservations.length})</h4>
                {ride.reservations.length ? (
                  <div className="timeline">
                    {ride.reservations.map((item) => (
                      <span className="timeline-item" key={item.id}>
                        {item.passenger.fullName},{" "}
                        {countOf(item.seats, "vaga", "vagas")}
                        <small>{reservationStatusLabel[item.status]}</small>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="subtle">Nenhuma reserva.</p>
                )}
              </section>
              <section>
                <h4>Solicitações ({ride.requests.length})</h4>
                {ride.requests.length ? (
                  <div className="timeline">
                    {ride.requests.map((item) => (
                      <span className="timeline-item" key={item.id}>
                        {item.passenger.fullName},{" "}
                        {countOf(item.seatsRequested, "vaga", "vagas")}
                        <small>{requestStatusLabel[item.status]}</small>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="subtle">Nenhuma solicitação.</p>
                )}
              </section>
            </div>
            <section>
              <h4>Histórico de status</h4>
              <div className="timeline">
                <span className="timeline-item">
                  Carona publicada
                  <small>{formatDateTime(ride.createdAt)}</small>
                </span>
                {ride.startedAt && (
                  <span className="timeline-item">
                    Carona iniciada
                    <small>{formatDateTime(ride.startedAt)}</small>
                  </span>
                )}
                {ride.completedAt && (
                  <span className="timeline-item">
                    Carona concluída
                    <small>{formatDateTime(ride.completedAt)}</small>
                  </span>
                )}
                {ride.cancellations.map((item) => (
                  <span className="timeline-item" key={item.id}>
                    Cancelamento por {item.cancelledBy.fullName}
                    <small>{formatDateTime(item.createdAt)}</small>
                  </span>
                ))}
              </div>
            </section>
            {ride.incidents.length ? (
              <section>
                <h4>Denúncias relacionadas</h4>
                <div className="timeline">
                  {ride.incidents.map((item) => (
                    <span className="timeline-item" key={item.id}>
                      {incidentTypeLabel[item.type]}
                      <small>{incidentStatusLabel[item.status]}</small>
                    </span>
                  ))}
                </div>
              </section>
            ) : (
              <p className="quiet-note">
                <Flag size={14} aria-hidden="true" />
                <span>Nenhuma denúncia está relacionada a esta carona.</span>
              </p>
            )}
            <p className="quiet-note">
              <LockKeyhole size={14} aria-hidden="true" />
              <span>
                O valor é o anunciado pelo motorista e não representa pagamento
                confirmado. Cancelamento administrativo de carona ainda não está
                disponível no painel.
              </span>
            </p>
          </div>
          <footer className="modal-footer">
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
          </footer>
        </>
      )}
    </Modal>
  )
}
