"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { BadgeCheck, Bike } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const MembershipQuery = graphql(`
  query Membership {
    membershipPlans {
      id
      name
      priceMinor
      freeDeliveryThresholdMinor
      deliveryDiscountBps
      billingPeriodDays
    }
    myMembership {
      id
      status
      isActive
      autoRenew
      currentPeriodEnd
      plan {
        id
        name
        priceMinor
      }
    }
    myPaymentMethods {
      id
      brand
      last4
      isDefault
    }
  }
`);

const SubscribeMutation = graphql(`
  mutation SubscribeMembership($planId: String!, $paymentMethodId: String!) {
    subscribeMembership(planId: $planId, paymentMethodId: $paymentMethodId) {
      id
      status
      isActive
    }
  }
`);

const CancelMutation = graphql(`
  mutation CancelMembership {
    cancelMembership {
      id
      status
      autoRenew
    }
  }
`);

export default function MembershipPage() {
  const router = useRouter();
  const [{ data, fetching }, refetch] = useQuery({
    query: MembershipQuery,
    requestPolicy: "cache-and-network",
  });
  const [subState, subscribe] = useMutation(SubscribeMutation);
  const [, cancel] = useMutation(CancelMutation);
  const [error, setError] = useState<string | null>(null);

  const plans = data?.membershipPlans ?? [];
  const membership = data?.myMembership;
  const methods = data?.myPaymentMethods ?? [];
  const isActive = membership?.isActive ?? false;

  async function onSubscribe(planId: string) {
    setError(null);
    // Membership is card-billed (nothing to collect on delivery). Guide the user to
    // add a card first if they have none.
    const paymentMethodId = methods.find((m) => m.isDefault)?.id ?? methods[0]?.id;
    if (!paymentMethodId) {
      router.push("/payment-methods");
      return;
    }
    const result = await subscribe({ planId, paymentMethodId });
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? "Could not start membership");
      return;
    }
    refetch({ requestPolicy: "network-only" });
  }

  async function onCancel() {
    setError(null);
    const result = await cancel({});
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? "Could not cancel");
      return;
    }
    refetch({ requestPolicy: "network-only" });
  }

  return (
    <main className="mx-auto max-w-lg">
      <div className="mb-6 flex items-center gap-2">
        <Bike className="h-6 w-6 text-kd-primary" />
        <h1 className="text-2xl font-bold">Herald Pro</h1>
      </div>
      <p className="mb-6 text-sm text-kd-fg-muted">
        A membership that pays for itself: free or discounted delivery on every order.
      </p>

      {membership && (
        <div className="mb-6 rounded-xl border border-kd-border bg-kd-surface p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BadgeCheck
                className={isActive ? "h-5 w-5 text-kd-success" : "h-5 w-5 text-kd-fg-subtle"}
              />
              <span className="font-semibold">{membership.plan.name}</span>
            </div>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                isActive
                  ? "bg-kd-success-soft text-kd-success"
                  : "bg-kd-surface-muted text-kd-fg-muted"
              }`}
            >
              {isActive ? "Active" : membership.status}
            </span>
          </div>
          {membership.currentPeriodEnd && (
            <p className="mt-2 text-xs text-kd-fg-muted">
              {/* No auto-renewal path exists yet (#89): the plan is charged once at */}
              {/* subscribe and benefits lapse at currentPeriodEnd. Always show this as */}
              {/* an access-until date so we don't promise billing that never happens. */}
              Access until{" "}
              {new Date(membership.currentPeriodEnd).toLocaleDateString("en-PK", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </p>
          )}
          {isActive && membership.autoRenew && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onCancel}>
              Cancel membership
            </Button>
          )}
          {isActive && !membership.autoRenew && (
            <p className="mt-3 text-xs text-kd-fg-subtle">
              Auto-renew is off. Your benefits stay until the date above.
            </p>
          )}
        </div>
      )}

      {fetching && plans.length === 0 && <p className="text-sm text-kd-fg-subtle">Loading…</p>}

      <div className="space-y-3">
        {plans.map((plan) => {
          const freeThreshold = plan.freeDeliveryThresholdMinor;
          const discountPct = Math.round(plan.deliveryDiscountBps / 100);
          return (
            <div
              key={plan.id}
              className="rounded-xl border border-kd-border bg-kd-surface p-4"
            >
              <div className="flex items-baseline justify-between">
                <p className="text-lg font-semibold">{plan.name}</p>
                <p className="text-lg font-bold text-kd-primary">
                  {formatRs(plan.priceMinor)}
                  <span className="text-xs font-normal text-kd-fg-muted">
                    {" "}
                    / {plan.billingPeriodDays === 30 ? "month" : `${plan.billingPeriodDays} days`}
                  </span>
                </p>
              </div>
              <Separator className="my-3" />
              <ul className="space-y-1.5 text-sm text-kd-fg">
                <li className="flex items-center gap-2">
                  <BadgeCheck className="h-4 w-4 text-kd-success" />
                  Free delivery on orders over {formatRs(freeThreshold)}
                </li>
                {discountPct > 0 && (
                  <li className="flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-kd-success" />
                    {discountPct}% off delivery on smaller orders
                  </li>
                )}
              </ul>
              {!isActive && (
                <Button
                  className="mt-4 w-full"
                  disabled={subState.fetching}
                  onClick={() => onSubscribe(plan.id)}
                >
                  {subState.fetching
                    ? "Starting…"
                    : methods.length === 0
                      ? "Add a card to join"
                      : `Join for ${formatRs(plan.priceMinor)}`}
                </Button>
              )}
            </div>
          );
        })}
        {!fetching && plans.length === 0 && (
          <p className="text-sm text-kd-fg-muted">No membership plans available right now.</p>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-kd-danger">{error}</p>}

      <p className="mt-6 text-xs text-kd-fg-subtle">
        Billed to your saved card via our mock gateway. Manage cards on the{" "}
        <Link href="/payment-methods" className={buttonVariants({ variant: "link", size: "sm" })}>
          payment methods
        </Link>{" "}
        page.
      </p>
    </main>
  );
}
