"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  /** Visible field label. */
  label: React.ReactNode;
  /** id of the control this label points at. Falls back to a generated id. */
  htmlFor?: string;
  /** Error message; when set the control is marked aria-invalid. */
  error?: React.ReactNode;
  /** Optional helper text shown below the control. */
  hint?: React.ReactNode;
  /** The control. Omit to render a default <Input> bound to this field. */
  children?: React.ReactNode;
  className?: string;
}

function FormField({ label, htmlFor, error, hint, children, className }: FormFieldProps) {
  const generatedId = React.useId();
  const fieldId = htmlFor ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy = cn(hint && hintId, error && errorId) || undefined;

  const control = children ?? (
    <Input
      id={fieldId}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy}
    />
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={fieldId} className="text-kd-fg">
        {label}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-kd-caption text-kd-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-kd-caption text-kd-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { FormField };
export type { FormFieldProps };
