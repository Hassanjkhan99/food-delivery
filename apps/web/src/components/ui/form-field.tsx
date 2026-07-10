"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Accessibility props FormField wires onto the control (default <Input> or a
 * single custom child): the id the <Label> points at, plus hint/error association.
 */
interface FormFieldControlProps {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

interface FormFieldOwnProps {
  /** Visible field label. */
  label: React.ReactNode;
  /** id of the control this label points at. Falls back to a generated id. */
  htmlFor?: string;
  /** Error message; when set the control is marked aria-invalid. */
  error?: React.ReactNode;
  /** Optional helper text shown below the control. */
  hint?: React.ReactNode;
  /**
   * The control. Omit to render a default <Input> (extra props are forwarded to
   * it). Pass a single element to use a custom control — the accessibility props
   * (id, aria-invalid, aria-describedby) are cloned onto it.
   */
  children?: React.ReactElement<Partial<FormFieldControlProps>>;
  className?: string;
}

/**
 * When `children` is omitted the default <Input> also accepts native input props
 * (name, value, onChange, placeholder, required, …), which are forwarded to it.
 */
type FormFieldProps = FormFieldOwnProps &
  Omit<React.ComponentProps<typeof Input>, keyof FormFieldOwnProps>;

function FormField({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
  ...inputProps
}: FormFieldProps) {
  const generatedId = React.useId();
  const fieldId = htmlFor ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const describedBy = cn(hint && hintId, error && errorId) || undefined;
  const controlProps: FormFieldControlProps = {
    id: fieldId,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  };

  const control = children ? (
    React.cloneElement(children, controlProps)
  ) : (
    <Input {...controlProps} {...inputProps} />
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
