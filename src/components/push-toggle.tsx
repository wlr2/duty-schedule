"use client";

// "Enable notifications" card: registers the service worker, asks browser
// permission, subscribes to Web Push, and stores the subscription server-side.
import { useEffect, useState } from "react";
import { BellRing, CheckCircle2 } from "lucide-react";
import {
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
} from "@/app/notifications/actions";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidPublicKey) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, [vapidPublicKey]);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      setState("on");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await sendTestPush();
      setTestSent(true);
      setTimeout(() => setTestSent(false), 4000);
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  return (
    <div className="mb-5 rounded-xl border border-slate-200 bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {state === "on" ? (
            <CheckCircle2 size={20} className="text-green-600" aria-hidden />
          ) : (
            <BellRing size={20} className="text-slate-500" aria-hidden />
          )}
          <div>
            <p className="text-sm font-medium">
              {state === "on"
                ? "Push notifications are on for this device"
                : "Get notified on this device"}
            </p>
            <p className="text-xs text-slate-500">
              {state === "unsupported" &&
                "This browser doesn't support push. On iPhone/iPad: add the app to your Home Screen first."}
              {state === "denied" &&
                "Notifications are blocked — allow them in your browser's site settings, then reload."}
              {state === "off" && "Leave requests, approvals and coverage gaps will pop up instantly."}
              {state === "on" && "You'll get leave, approval and coverage-gap alerts even when the app is closed."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {state === "on" && (
            <button
              onClick={test}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {testSent ? "Sent ✓" : "Send test"}
            </button>
          )}
          {state === "off" && (
            <button
              onClick={enable}
              disabled={busy}
              className="rounded-lg bg-violet px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-soft disabled:opacity-50"
            >
              Enable
            </button>
          )}
          {state === "on" && (
            <button
              onClick={disable}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              Turn off
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
