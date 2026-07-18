"use client";

import { useState } from "react";

import { Tabs, TabsList, TabsTab, TabsPanel, SegmentedControl } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "@/components/ui/accordion";
import { LoadMore, Pagination } from "@/components/ui/pagination";

/** Interactive (client) showcase for the navigation primitives — kept out of the
 *  server-rendered design page so it can hold local state. */
export function NavDemos() {
  const [seg, setSeg] = useState("all");
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(1);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-kd-label font-semibold text-kd-fg">Tabs (underline, with panels)</p>
        <Tabs defaultValue="menu">
          <TabsList>
            <TabsTab value="menu">Menu</TabsTab>
            <TabsTab value="reviews">Reviews</TabsTab>
            <TabsTab value="info">Info</TabsTab>
          </TabsList>
          <TabsPanel value="menu" className="text-sm text-kd-fg-muted">
            Menu items go here.
          </TabsPanel>
          <TabsPanel value="reviews" className="text-sm text-kd-fg-muted">
            Customer reviews go here.
          </TabsPanel>
          <TabsPanel value="info" className="text-sm text-kd-fg-muted">
            Hours, address and contact go here.
          </TabsPanel>
        </Tabs>
      </div>

      <div className="space-y-2">
        <p className="text-kd-label font-semibold text-kd-fg">SegmentedControl (current: {seg})</p>
        <SegmentedControl
          value={seg}
          onValueChange={setSeg}
          options={[
            { value: "all", label: "All" },
            { value: "open", label: "Open now" },
            { value: "free", label: "Free delivery" },
          ]}
        />
      </div>

      <div className="space-y-2">
        <p className="text-kd-label font-semibold text-kd-fg">Accordion</p>
        <Accordion defaultValue={["0"]}>
          <AccordionItem value="0">
            <AccordionTrigger>Delivery &amp; timing</AccordionTrigger>
            <AccordionPanel>Delivered in 25–35 min. Free over Rs 1,000.</AccordionPanel>
          </AccordionItem>
          <AccordionItem value="1">
            <AccordionTrigger>Allergens</AccordionTrigger>
            <AccordionPanel>Contains nuts and dairy. Ask staff for details.</AccordionPanel>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="space-y-3">
        <p className="text-kd-label font-semibold text-kd-fg">LoadMore / Pagination</p>
        <p className="text-sm text-kd-fg-muted">Loaded {loaded} of 3 pages</p>
        <LoadMore hasMore={loaded < 3} onLoadMore={() => setLoaded((n) => n + 1)} />
        <Pagination page={page} pageCount={5} onPageChange={setPage} />
      </div>
    </div>
  );
}
