"use client"

import { moveFocusBetweenPeers } from "../../navigationKeys.js"
import { Skeleton } from "../../leaf/Skeleton/index.js"
import type { StepperProps, StepperStepState } from "./index.js"

type BarProps = Extract<StepperProps, { readonly kind: "bar" }> & { readonly states: ReadonlyArray<StepperStepState> }

/**
 * The segmented bar form of `Stepper` (`kind="bar"`): one equal segment per step, filled up to and including the current step; under it
 * the current step's label and description. Every step's label stays in the accessibility tree (hidden visually) and the current one
 * carries `aria-current="step"`. With `onStepSelect` each segment is a button. Loading keeps the segments and the caption line as
 * geometry, nothing current and nothing pressable.
 */
export const StepperBar = ({ label, steps, states, currentStepId, onStepSelect, stateLabel, isLoading = false }: BarProps) => {
    const current = steps.find((step) => step.id === currentStepId)
    const select = isLoading ? undefined : onStepSelect
    return (
        <nav
            aria-label={label}
            {...(isLoading ? { "aria-busy": true, "data-loading": "true" } : {})}
            className="starci-core-stepper"
            data-component="Stepper"
            data-tier="composite"
            data-grammar-stepper-kind="bar"
            data-grammar-stepper-interactive={select === undefined ? "false" : "true"}
        >
            <ol
                className="starci-core-stepper-list"
                data-contract={select === undefined ? "HIERARCHY-3" : "HIERARCHY-3 FOCUS-2"}
                {...(select === undefined ? {} : { onKeyDown: (event) => { moveFocusBetweenPeers(event, "[data-grammar-step-control]", "horizontal") } })}
            >
                {steps.map((step, index) => {
                    const state = isLoading ? "upcoming" : states[index] ?? "upcoming"
                    const announcement = isLoading ? undefined : stateLabel?.(state)
                    const segment = <span aria-hidden="true" className="starci-core-step-bar" data-grammar-step-bar="true">{isLoading ? <Skeleton shape="rect" /> : null}</span>
                    const name = <span className="starci-core-nav-visually-hidden">{announcement === undefined ? step.label : `${step.label}, ${announcement}`}</span>
                    return (
                        <li
                            key={step.id}
                            {...(state === "current" ? { "aria-current": "step" as const } : {})}
                            className="starci-core-step"
                            data-contract="STATE-1"
                            data-grammar-step-state={state}
                            data-grammar-current={state === "current" ? "true" : "false"}
                        >
                            {select === undefined ? <span className="starci-core-step-body">{segment}{name}</span> : (
                                <button
                                    className="starci-core-step-body starci-core-step-control"
                                    data-contract="FOCUS-1"
                                    data-grammar-step-control="true"
                                    disabled={step.isDisabled === true}
                                    onClick={() => select(step.id)}
                                    type="button"
                                >{segment}{name}</button>
                            )}
                        </li>
                    )
                })}
            </ol>
            <div className="starci-core-stepper-caption" data-grammar-stepper-caption="true">
                {isLoading
                    ? <span aria-hidden="true" className="starci-core-step-skeleton-label"><Skeleton shape="text" /></span>
                    : current === undefined ? null : (
                        <>
                            <span className="starci-core-step-label" data-grammar-step-label="true">{current.label}</span>
                            {current.description === undefined ? null : <span className="starci-core-step-description" data-grammar-step-description="true">{current.description}</span>}
                        </>
                    )}
            </div>
        </nav>
    )
}
