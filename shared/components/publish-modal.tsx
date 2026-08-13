"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Rocket, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/shared/components/ui/toast";
import { campusStore } from "@/shared/lib/campus-store";

interface PublishModalProps {
  open: boolean;
  onClose: () => void;
}

export function PublishModal({ open, onClose }: PublishModalProps) {
  const { toast } = useToast();
  const [publishing, setPublishing] = React.useState(false);

  const handleConfirmPublish = async () => {
    setPublishing(true);
    try {
      const res = await campusStore.publishToServer();
      if (!res.success) {
        toast({
          type: "error",
          title: "Publish Failed",
          description: res.error || "Failed to publish campus data to server.",
        });
      } else {
        toast({
          type: "success",
          title: "Digital Twin Published!",
          description: `Version ${res.version || "v2.0"} is now live and saved in database.`,
        });
        onClose();
      }
    } catch (err: unknown) {
      toast({
        type: "error",
        title: "Publish Error",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setPublishing(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-md rounded-xl border bg-[rgb(var(--card))] p-6 shadow-2xl space-y-5"
        >
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-[rgb(var(--primary))]" />
              <h3 className="font-bold text-lg text-[rgb(var(--fg))]">Confirm Publish</h3>
            </div>
            <Button size="sm" variant="ghost" onClick={onClose} disabled={publishing}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2 text-sm text-[rgb(var(--muted-fg))] leading-relaxed">
            <p>
              Are you sure you want to publish the updated Digital Twin graph live for all users?
            </p>
            <p className="text-xs italic text-[rgb(var(--muted-fg))]/80">
              All saved draft changes, nodes, edges, buildings, and navigation paths will become active immediately and stored in PostgreSQL database.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onClose} disabled={publishing}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmPublish}
              disabled={publishing}
              className="bg-[rgb(var(--primary))] text-white hover:brightness-110"
            >
              {publishing ? "Publishing to DB..." : "Confirm & Publish"}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
