"use client";

import { useState } from "react";

import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { NumberStepper } from "@/components/ui/number-stepper";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RatingStars } from "@/components/ui/rating-stars";

const CITIES: Record<string, string> = { khi: "Karachi", lhr: "Lahore", isb: "Islamabad" };

/** Interactive (client) showcase for the form-control primitives. */
export function FormDemos() {
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [qty, setQty] = useState<number | null>(1);
  const [city, setCity] = useState("khi");
  const [rating, setRating] = useState(4);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm text-kd-fg">
          <Switch checked={on} onCheckedChange={setOn} />
          Switch ({on ? "on" : "off"})
        </label>
        <label className="flex items-center gap-2 text-sm text-kd-fg">
          <Checkbox checked={checked} onCheckedChange={setChecked} />
          Checkbox
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="space-y-1">
          <p className="text-kd-caption text-kd-fg-muted">NumberStepper ({qty ?? 0})</p>
          <NumberStepper value={qty} onValueChange={setQty} min={1} max={9} />
        </div>
        <div className="w-52 space-y-1">
          <p className="text-kd-caption text-kd-fg-muted">Select</p>
          <Select value={city} onValueChange={(v) => setCity(String(v))}>
            <SelectTrigger>
              <SelectValue>{(v) => CITIES[v as string]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="khi">Karachi</SelectItem>
              <SelectItem value="lhr">Lahore</SelectItem>
              <SelectItem value="isb">Islamabad</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-6">
        <div className="space-y-1">
          <p className="text-kd-caption text-kd-fg-muted">RatingStars (display)</p>
          <RatingStars value={4.5} count={1240} />
        </div>
        <div className="space-y-1">
          <p className="text-kd-caption text-kd-fg-muted">RatingStars (interactive: {rating})</p>
          <RatingStars value={rating} onChange={setRating} size="lg" />
        </div>
      </div>
    </div>
  );
}
