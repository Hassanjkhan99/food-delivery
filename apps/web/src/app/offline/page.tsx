export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-neutral-50 p-8 text-center">
      <span className="text-5xl">📡</span>
      <h1 className="text-xl font-bold text-neutral-900">You&apos;re offline</h1>
      <p className="max-w-xs text-sm text-neutral-500">
        We couldn&apos;t reach the kitchen. Check your connection and pull to refresh — your cart is
        saved on this device.
      </p>
    </main>
  );
}
