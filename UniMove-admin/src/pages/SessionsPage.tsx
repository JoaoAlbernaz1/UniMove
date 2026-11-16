import { useState } from "react"
import { Laptop, LockKeyhole, LogOut, Smartphone } from "lucide-react"
import { DataTable, type Column } from "../components/DataTable"
import {
  Badge,
  Button,
  ConfirmModal,
  EmptyState,
  ErrorState,
  Loading,
  PageIntro,
} from "../components/ui"
import { useQuery } from "../hooks/useQuery"
import { useAdmin } from "../layout/AdminContext"
import { formatDateTime } from "../lib/format"
import { describeDevice, readSessionDevice } from "../lib/userAgent"
import { sessionsApi } from "../services/adminIamApi"
import { asDisplayError } from "../services/adminIamErrors"
import type { AdminSessionRow } from "../types/admin-iam"

type Target = { kind: "one"; session: AdminSessionRow } | { kind: "others" }

export default function SessionsPage() {
  const { showToast } = useAdmin()
  const [target, setTarget] = useState<Target | null>(null)
  const list = useQuery(() => sessionsApi.mine(), [])

  const sessions = list.data?.items ?? []
  const revocable = sessions.filter((session) => !session.current)

  const columns: Column<AdminSessionRow>[] = [
    {
      key: "device",
      header: "Dispositivo",
      primary: true,
      cell: (row) => {
        const device = readSessionDevice(row.userAgent)
        return (
          <div className="person-cell">
            <span className="attention-icon blue">
              {device.handheld ? (
                <Smartphone size={16} aria-hidden="true" />
              ) : (
                <Laptop size={16} aria-hidden="true" />
              )}
            </span>
            <span>
              <strong>{device.platform ?? "Plataforma não identificada"}</strong>
              <small>{device.browser ?? "Navegador não identificado"}</small>
            </span>
          </div>
        )
      },
    },
    {
      key: "started",
      header: "Início da sessão",
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      key: "expires",
      header: "Expira em",
      cell: (row) => formatDateTime(row.expiresAt),
    },
    {
      key: "state",
      header: "Situação",
      cell: (row) => (
        <Badge tone={row.current ? "green" : "blue"}>
          {row.current ? "Sessão atual" : "Ativa"}
        </Badge>
      ),
    },
    {
      key: "action",
      header: "Ação",
      action: true,
      cell: (row) =>
        row.current ? (
          <span className="subtle">Sessão em uso</span>
        ) : (
          <Button
            variant="ghost"
            size="small"
            onClick={() => setTarget({ kind: "one", session: row })}
          >
            Encerrar
          </Button>
        ),
    },
  ]

  return (
    <>
      <PageIntro
        title="Sessões ativas"
        description="Dispositivos autenticados no painel com a sua conta."
        action={
          <Button
            variant="danger"
            disabled={revocable.length === 0}
            onClick={() => setTarget({ kind: "others" })}
          >
            <LogOut size={15} aria-hidden="true" /> Encerrar outras ({revocable.length})
          </Button>
        }
      />

      <section className="panel">
        {list.loading ? (
          <Loading label="Carregando sessões..." />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.reload()} />
        ) : sessions.length === 0 ? (
          <EmptyState
            title="Nenhuma sessão listada"
            description="Sessões abertas antes da publicação desta versão aparecem no próximo login."
          />
        ) : (
          <DataTable
            label="Sessões administrativas"
            columns={columns}
            rows={sessions}
            rowKey={(row) => row.id}
          />
        )}
      </section>

      <p className="privacy-note">
        <LockKeyhole size={15} aria-hidden="true" />
        <span>
          O painel guarda apenas a identificação que o navegador envia. Não há
          registro de localização, e o que não dá para afirmar aparece como não
          identificado.
        </span>
      </p>

      {target?.kind === "one" && (
        <ConfirmModal
          title="Encerrar esta sessão"
          description={`A sessão em ${describeDevice(target.session.userAgent)} será encerrada imediatamente.`}
          confirmLabel="Encerrar sessão"
          destructive
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            try {
              await sessionsApi.revoke(target.session.id)
              setTarget(null)
              void list.reload()
              showToast({ message: "Sessão encerrada." })
            } catch (reason) {
              throw asDisplayError(reason)
            }
          }}
        />
      )}

      {target?.kind === "others" && (
        <ConfirmModal
          title="Encerrar as outras sessões"
          description="Os outros dispositivos exigirão novo login com senha e segundo fator. Esta sessão continua aberta."
          confirmLabel="Encerrar outras sessões"
          destructive
          onClose={() => setTarget(null)}
          onConfirm={async () => {
            try {
              const result = await sessionsApi.revokeOthers()
              setTarget(null)
              void list.reload()
              showToast({
                message:
                  result.revoked === 1
                    ? "1 sessão encerrada."
                    : `${result.revoked} sessões encerradas.`,
              })
            } catch (reason) {
              throw asDisplayError(reason)
            }
          }}
        />
      )}
    </>
  )
}
