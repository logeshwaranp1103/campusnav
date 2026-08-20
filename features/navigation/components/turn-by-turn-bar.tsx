"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
  RotateCcw,
  Footprints,
  Navigation,
  X,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Camera,
  Image as ImageIcon,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cleanLandmarkName, type DirectionStep } from "@/lib/routing/directions";

interface TurnByTurnBarProps {
  currentStep: DirectionStep | null;
  nextStep: DirectionStep | null;
  totalDistanceMeters: number;
  remainingDistanceMeters: number;
  currentStepIndex: number;
  totalStepsCount: number;
  onEndNavigation: () => void;
  onRecalculate?: () => void;
  onNextStep?: () => void;
  onPrevStep?: () => void;
  isOffRoute?: boolean;
}

export function TurnByTurnBar({
  currentStep,
  nextStep,
  totalDistanceMeters,
  remainingDistanceMeters,
  currentStepIndex,
  totalStepsCount,
  onEndNavigation,
  onRecalculate,
  onNextStep,
  onPrevStep,
  isOffRoute,
}: TurnByTurnBarProps) {
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [imageError, setImageError] = useState(false);

  if (!currentStep) return null;

  const activePhotoUrl = currentStep.photoUrl || nextStep?.photoUrl;
  const photoNodeName = currentStep.photoUrl
    ? (cleanLandmarkName(currentStep.targetNodeName) || currentStep.text || "Reference Location")
    : (cleanLandmarkName(nextStep?.targetNodeName) || nextStep?.text || "Upcoming Landmark");

  const progressPct = Math.min(
    100,
    Math.max(0, Math.round(((totalDistanceMeters - remainingDistanceMeters) / (totalDistanceMeters || 1)) * 100))
  );

  const etaMinutes = Math.max(1, Math.round(remainingDistanceMeters / 70));

  const renderIcon = (icon: DirectionStep["icon"]) => {
    switch (icon) {
      case "straight":
        return <ArrowUp className="h-6 w-6 text-emerald-400" />;
      case "slight-left":
        return <ArrowUpLeft className="h-6 w-6 text-emerald-400" />;
      case "left":
        return <ArrowLeft className="h-6 w-6 text-emerald-400" />;
      case "sharp-left":
        return <ArrowDownLeft className="h-6 w-6 text-emerald-400" />;
      case "slight-right":
        return <ArrowUpRight className="h-6 w-6 text-emerald-400" />;
      case "right":
        return <ArrowRight className="h-6 w-6 text-emerald-400" />;
      case "sharp-right":
        return <ArrowDownRight className="h-6 w-6 text-emerald-400" />;
      case "u-turn":
        return <RotateCcw className="h-6 w-6 text-amber-400" />;
      case "stairs-up":
      case "stairs-down":
        return <Footprints className="h-6 w-6 text-indigo-400" />;
      case "lift":
        return <Navigation className="h-6 w-6 text-blue-400" />;
      case "arrive":
        return <CheckCircle2 className="h-6 w-6 text-emerald-400" />;
      default:
        return <ArrowUp className="h-6 w-6 text-emerald-400" />;
    }
  };

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed bottom-4 left-3 right-3 sm:left-4 sm:right-4 z-40 mx-auto max-w-lg rounded-2xl border bg-gray-900/95 p-3.5 sm:p-4 shadow-2xl backdrop-blur-md text-white border-gray-800 space-y-2.5 sm:space-y-3 pointer-events-auto"
        >
          {/* Off-Route Alert */}
          {isOffRoute && (
            <div className="flex items-center justify-between rounded-xl bg-amber-500/20 border border-amber-500/40 p-2 text-xs text-amber-300">
              <span className="font-semibold">⚠️ Off route detected! Recalculating path...</span>
              {onRecalculate && (
                <Button size="sm" onClick={onRecalculate} className="h-6 text-[10px] bg-amber-600 hover:bg-amber-700 text-white">
                  Recalculate
                </Button>
              )}
            </div>
          )}

          {/* Primary Instruction Row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/30 shadow-inner">
                {renderIcon(currentStep.icon)}
              </div>
              <div className="min-w-0 flex-1">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={currentStep.text}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.15 }}
                  >
                    <h3 className="font-bold text-base leading-tight text-white truncate">{currentStep.text}</h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 font-medium">
                      {currentStep.distanceMeters > 0 ? (
                        <span className="text-emerald-400 font-bold">{currentStep.distanceMeters} m ahead</span>
                      ) : (
                        <span className="text-emerald-400 font-bold">Arrived</span>
                      )}
                      <span>•</span>
                      <span>Step {currentStepIndex + 1} of {totalStepsCount}</span>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Reference Photo Action Button */}
              {activePhotoUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setImageError(false);
                    setShowPhotoModal(true);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition-all active:scale-95 cursor-pointer shadow-xs"
                  title="View real-world reference photo"
                >
                  <Camera className="h-4 w-4" />
                  <span className="hidden sm:inline">Photo</span>
                </button>
              )}

              {/* Step Prev/Next Navigation Controls */}
              {onPrevStep && currentStepIndex > 0 && (
                <button
                  onClick={onPrevStep}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-800/80 hover:bg-gray-800 text-gray-300 hover:text-white border border-gray-700/60 transition-colors"
                  title="Previous Step"
                  aria-label="Previous Step"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {onNextStep && currentStepIndex < totalStepsCount - 1 && (
                <button
                  onClick={onNextStep}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-800/80 hover:bg-gray-800 text-gray-300 hover:text-white border border-gray-700/60 transition-colors"
                  title="Next Step"
                  aria-label="Next Step"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}

              <Button
                size="sm"
                variant="ghost"
                onClick={onEndNavigation}
                className="h-8 w-8 p-0 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-white shrink-0"
                title="End Navigation"
                aria-label="End Navigation"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Next Step Preview Banner */}
          {nextStep && (
            <div className="flex items-center gap-2 border-t border-gray-800/80 pt-2 text-xs text-gray-300">
              <span className="font-semibold text-emerald-400 uppercase tracking-wider text-[10px] shrink-0">THEN:</span>
              <span className="truncate font-medium">{nextStep.text}</span>
              {nextStep.distanceMeters > 0 && (
                <span className="text-[10px] text-gray-400 ml-auto shrink-0 font-mono">({nextStep.distanceMeters}m)</span>
              )}
            </div>
          )}

          {/* Route Progress Bar & Remaining Stats */}
          <div className="space-y-1.5 border-t border-gray-800/80 pt-2 text-xs">
            <div className="flex items-center justify-between text-gray-300 font-medium">
              <span className="text-emerald-400 font-bold">{remainingDistanceMeters}m remaining</span>
              <span>~{etaMinutes} min walk</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Reference Image Modal */}
      <AnimatePresence>
        {showPhotoModal && activePhotoUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 p-4 shadow-2xl text-white"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white truncate max-w-[260px]">{photoNodeName}</h4>
                    <p className="text-[11px] text-gray-400">Visual landmark reference</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPhotoModal(false)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition-colors cursor-pointer"
                  title="Close reference photo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Photo Display Body */}
              <div className="mt-3 relative w-full overflow-hidden rounded-xl bg-transparent flex items-center justify-center border border-gray-800/80">
                {imageError ? (
                  <div className="flex flex-col items-center justify-center p-6 text-center text-gray-400">
                    <AlertCircle className="h-8 w-8 text-amber-400 mb-2" />
                    <p className="text-sm font-medium">Reference image unavailable</p>
                    <p className="text-xs text-gray-500 mt-1">Continue following turn-by-turn navigation.</p>
                  </div>
                ) : (
                  <img
                    src={activePhotoUrl}
                    alt={photoNodeName}
                    onError={(e) => {
                      const targetId = currentStep.targetNodeId || nextStep?.targetNodeId;
                      const apiFallback = targetId ? `/api/nodes/${targetId}/photo` : null;
                      const imgEl = e.target as HTMLImageElement;
                      if (apiFallback && !imgEl.src.endsWith(apiFallback)) {
                        imgEl.src = apiFallback;
                      } else {
                        setImageError(true);
                      }
                    }}
                    className="w-full h-auto max-h-[65vh] object-contain rounded-xl"
                    loading="eager"
                  />
                )}
              </div>

              {/* Footer */}
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => setShowPhotoModal(false)}
                  className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-4"
                >
                  Close Reference
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
