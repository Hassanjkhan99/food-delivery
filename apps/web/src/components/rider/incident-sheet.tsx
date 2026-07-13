"use client";

// Themed incident reporter (#169), replacing the native prompt()/alert() flow — big tap
// targets, preset reasons, an optional note, and an in-app confirmation. Fully controlled
// (no trigger render-prop) so it plays nicely inside the job screen's action stack.
import { useState } from "react";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const REASONS = [
  { value: "customer_unreachable", label: "Customer unreachable" },
  { value: "address_wrong", label: "Address wrong / can’t find it" },
  { value: "accident_vehicle", label: "Accident / vehicle issue" },
  { value: "restaurant_delay", label: "Restaurant delay" },
  { value: "other", label: "Something else" },
];

// onSubmit returns an error message to show, or null on success. Keeping the mutation in
// the parent means this component stays presentation-only and reusable.
export function IncidentSheet({
  onSubmit,
}: {
  onSubmit: (note: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setReason("");
    setNote("");
    setError(null);
    setDone(false);
    setSubmitting(false);
  }

  async function submit() {
    const label = REASONS.find((r) => r.value === reason)?.label ?? "Problem";
    // reportIncident takes a single note (no category arg), so fold the reason into it.
    const full = note.trim() ? `${label} — ${note.trim()}` : label;
    setSubmitting(true);
    setError(null);
    const err = await onSubmit(full);
    setSubmitting(false);
    if (err) {
      setError(err);
      return;
    }
    setDone(true);
  }

  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)}>
        Report a problem
      </Button>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="border-b border-kd-border">
            <SheetTitle>Report a problem</SheetTitle>
          </SheetHeader>

          {done ? (
            <div className="p-6 text-center">
              <p className="text-3xl">✅</p>
              <p className="mt-2 font-semibold">Reported — support will follow up.</p>
              <Button className="mt-5 w-full" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-4 px-4">
                <RadioGroup value={reason} onValueChange={setReason} className="space-y-2">
                  {REASONS.map((r) => (
                    <Label
                      key={r.value}
                      htmlFor={`reason-${r.value}`}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-kd-border p-4 has-data-[checked]:border-kd-primary has-data-[checked]:bg-kd-primary-soft"
                    >
                      <RadioGroupItem id={`reason-${r.value}`} value={r.value} />
                      <span className="text-sm font-medium">{r.label}</span>
                    </Label>
                  ))}
                </RadioGroup>
                <Textarea
                  placeholder="Add any detail (optional)…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                />
                {error && <p className="text-sm text-kd-danger">{error}</p>}
              </div>
              <SheetFooter className="flex-row gap-3 border-t border-kd-border">
                <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" disabled={!reason || submitting} onClick={submit}>
                  {submitting ? "Sending…" : "Send report"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
