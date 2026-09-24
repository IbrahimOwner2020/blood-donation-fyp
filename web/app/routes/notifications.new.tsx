import { Form, Link, data, redirect, useActionData, useLoaderData, useNavigation, type ClientActionFunctionArgs, type ClientLoaderFunctionArgs, type MetaFunction } from "react-router";

import { ErrorState } from "~/components/ui/ErrorState";
import { PageHeader } from "~/components/ui/PageHeader";
import { fetchAuthSession, hasUiPermission, UI_PERMISSIONS, type AuthSession } from "~/lib/auth";
import { BLOOD_GROUP_OPTIONS, formatDonorName, listDonors, type PublicDonor } from "~/lib/donors";
import { formatApiErrorMessage, parseDonorIdList, previewNotifications, sendNotifications, type NotificationChannel, type NotificationPreviewItem } from "~/lib/notifications";

export const meta: MetaFunction = () => [{ title: "New notification · Blood Donation Management System" }];

type LoaderData = { session: AuthSession; donors: PublicDonor[] };
type ActionData = { error?: string; success?: string; previews?: NotificationPreviewItem[]; donorIds?: number[]; channel?: NotificationChannel; message?: string };

export async function clientLoader({ request }: ClientLoaderFunctionArgs): Promise<LoaderData> {
  const session = await fetchAuthSession();
  if (!session) throw redirect(`/login?next=${encodeURIComponent(new URL(request.url).pathname)}`);
  if (!hasUiPermission(session, UI_PERMISSIONS.notificationsRead)) throw new Response("Notification access required", { status: 403 });
  const result = await listDonors({ active: true, limit: 100 });
  return { session, donors: result.donors };
}

export async function clientAction({ request }: ClientActionFunctionArgs) {
  const session = await fetchAuthSession();
  if (!session) throw redirect("/login?next=/notifications/new");
  const form = await request.formData();
  const donorIds = parseDonorIdList(form);
  const channel = String(form.get("channel") || "SMS") === "EMAIL" ? "EMAIL" : "SMS";
  const message = String(form.get("message") || "").trim();
  const intent = String(form.get("intent") || "preview");
  if (!donorIds.length || !message) return data<ActionData>({ error: "Select at least one donor and enter a message." }, { status: 400 });
  try {
    if (intent === "send") {
      if (!hasUiPermission(session, UI_PERMISSIONS.notificationsSend)) return data<ActionData>({ error: "You do not have permission to send notifications." }, { status: 403 });
      const result = await sendNotifications({ donorIds, channel, message, alertId: null });
      return { success: `${result.sentCount} sent; ${result.failedCount} failed.` } satisfies ActionData;
    }
    const result = await previewNotifications({ donorIds, channel, message, alertId: null });
    return { previews: result.previews, donorIds, channel, message } satisfies ActionData;
  } catch (error) {
    return data<ActionData>({ error: formatApiErrorMessage(error, "Unable to prepare notifications.") }, { status: 400 });
  }
}

export default function NewNotificationPage() {
  const { session, donors } = useLoaderData<LoaderData>();
  const action = useActionData<ActionData>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return <div>
    <PageHeader title="Notify donors" description="Choose a donor group, preview every recipient, then confirm the send." actions={<Link to="/notifications" className="text-sm font-semibold text-nbts-teal underline">History</Link>} />
    {action?.error ? <div className="mb-4"><ErrorState title="Notification not prepared" message={action.error} /></div> : null}
    {action?.success ? <p className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{action.success}</p> : null}
    <Form method="post" className="rounded-lg border border-nbts-border bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm"><span className="mb-1 block font-medium">Channel</span><select name="channel" defaultValue="SMS" className="w-full rounded border border-nbts-border px-3 py-2"><option value="SMS">SMS</option><option value="EMAIL">Email</option></select></label>
        <label className="text-sm"><span className="mb-1 block font-medium">Blood group</span><select className="w-full rounded border border-nbts-border px-3 py-2" onChange={(event) => document.querySelectorAll<HTMLInputElement>("[data-donor]").forEach((box) => { box.checked = !event.target.value || box.dataset.group === event.target.value; })}><option value="">All groups</option>{BLOOD_GROUP_OPTIONS.map((group) => <option key={group.code}>{group.code}</option>)}</select></label>
        <label className="text-sm"><span className="mb-1 block font-medium">Eligibility group</span><select className="w-full rounded border border-nbts-border px-3 py-2" onChange={(event) => document.querySelectorAll<HTMLInputElement>("[data-donor]").forEach((box) => { if (event.target.value === "eligible") box.checked = box.dataset.eligible === "true"; else if (event.target.value === "soon") box.checked = Number(box.dataset.days || 999) <= 30; })}><option value="">Choose group</option><option value="eligible">Eligible now</option><option value="soon">Eligible within 30 days</option></select></label>
      </div>
      <div className="mt-4 max-h-72 overflow-auto rounded border border-nbts-border">
        {donors.map((donor) => <label key={donor.id} className="flex items-center gap-3 border-b border-nbts-border px-3 py-2 text-sm last:border-0"><input data-donor data-group={donor.bloodGroup?.code || ""} data-eligible={String(donor.preliminaryEligibility.status === "ELIGIBLE")} data-days={donor.preliminaryEligibility.daysUntilEligible ?? ""} type="checkbox" name="donorIds" value={donor.id} /><span className="flex-1">{formatDonorName(donor)} · {donor.donorNumber} · {donor.bloodGroup?.code || "—"} · {donor.address || "No address"}</span><span className="text-xs text-nbts-muted">{donor.preliminaryEligibility.status.replaceAll("_", " ")}</span></label>)}
      </div>
      <label className="mt-4 block text-sm"><span className="mb-1 block font-medium">Message</span><textarea name="message" required maxLength={2000} rows={4} defaultValue={action?.message} className="w-full rounded border border-nbts-border px-3 py-2" /></label>
      <button name="intent" value="preview" disabled={busy} className="mt-4 rounded bg-nbts-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Preview recipients</button>
    </Form>

    {action?.previews?.length ? <section className="mt-6 rounded-lg border border-nbts-border bg-white p-5"><h2 className="font-semibold">Preview</h2><ul className="mt-3 divide-y divide-nbts-border">{action.previews.map((item) => <li key={`${item.donorId}-${item.channel}`} className="py-3 text-sm"><p className="font-medium">{item.donorLabel || `Donor #${item.donorId}`} · {item.recipient}</p><p className="mt-1 text-nbts-muted">{item.message}</p></li>)}</ul>{hasUiPermission(session, UI_PERMISSIONS.notificationsSend) ? <Form method="post" className="mt-4">{action.donorIds?.map((id) => <input key={id} type="hidden" name="donorIds" value={id} />)}<input type="hidden" name="channel" value={action.channel} /><input type="hidden" name="message" value={action.message} /><button name="intent" value="send" disabled={busy} className="rounded bg-nbts-blood px-4 py-2 text-sm font-semibold text-white">Confirm and send</button></Form> : null}</section> : null}
  </div>;
}
