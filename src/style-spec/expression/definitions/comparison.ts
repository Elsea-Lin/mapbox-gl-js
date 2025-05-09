import {toString, ValueType, BooleanType, CollatorType} from '../types';
import Assertion from './assertion';
import {typeOf} from '../values';
import RuntimeError from '../runtime_error';

import type {Expression, SerializedExpression, ExpressionRegistration} from '../expression';
import type EvaluationContext from '../evaluation_context';
import type ParsingContext from '../parsing_context';
import type {Type} from '../types';

type ComparisonOperator = '==' | '!=' | '<' | '>' | '<=' | '>=';

function isComparableType(op: ComparisonOperator, type: Type) {
    if (op === '==' || op === '!=') {
        // equality operator
        return type.kind === 'boolean' ||
            type.kind === 'string' ||
            type.kind === 'number' ||
            type.kind === 'null' ||
            type.kind === 'value';
    } else {
        // ordering operator
        return type.kind === 'string' ||
            type.kind === 'number' ||
            type.kind === 'value';
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eq(ctx: EvaluationContext, a: any, b: any): boolean { return a === b; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function neq(ctx: EvaluationContext, a: any, b: any): boolean { return a !== b; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lt(ctx: EvaluationContext, a: any, b: any): boolean { return a < b; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gt(ctx: EvaluationContext, a: any, b: any): boolean { return a > b; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lteq(ctx: EvaluationContext, a: any, b: any): boolean { return a <= b; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gteq(ctx: EvaluationContext, a: any, b: any): boolean { return a >= b; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eqCollate(ctx: EvaluationContext, a: any, b: any, c: any): boolean { return c.compare(a, b) === 0; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function neqCollate(ctx: EvaluationContext, a: any, b: any, c: any): boolean { return !eqCollate(ctx, a, b, c); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ltCollate(ctx: EvaluationContext, a: any, b: any, c: any): boolean { return c.compare(a, b) < 0; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gtCollate(ctx: EvaluationContext, a: any, b: any, c: any): boolean { return c.compare(a, b) > 0; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lteqCollate(ctx: EvaluationContext, a: any, b: any, c: any): boolean { return c.compare(a, b) <= 0; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gteqCollate(ctx: EvaluationContext, a: any, b: any, c: any): boolean { return c.compare(a, b) >= 0; }

/**
 * Special form for comparison operators, implementing the signatures:
 * - (T, T, ?Collator) => boolean
 * - (T, value, ?Collator) => boolean
 * - (value, T, ?Collator) => boolean
 *
 * For inequalities, T must be either value, string, or number. For ==/!=, it
 * can also be boolean or null.
 *
 * Equality semantics are equivalent to Javascript's strict equality (===/!==)
 * -- i.e., when the arguments' types don't match, == evaluates to false, != to
 * true.
 *
 * When types don't match in an ordering comparison, a runtime error is thrown.
 *
 * @private
 */
function makeComparison(
    op: ComparisonOperator,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compareBasic: (arg1: EvaluationContext, arg2?: any, arg3?: any) => boolean,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compareWithCollator: (arg1: EvaluationContext, arg2?: any, arg3?: any, arg4?: any) => boolean,
): ExpressionRegistration {
    const isOrderComparison = op !== '==' && op !== '!=';

    return class Comparison implements Expression {
        type: Type;
        lhs: Expression;
        rhs: Expression;
        collator: Expression | null | undefined;
        hasUntypedArgument: boolean;

        constructor(lhs: Expression, rhs: Expression, collator?: Expression | null) {
            this.type = BooleanType;
            this.lhs = lhs;
            this.rhs = rhs;
            this.collator = collator;
            this.hasUntypedArgument = lhs.type.kind === 'value' || rhs.type.kind === 'value';
        }

        static parse(args: ReadonlyArray<unknown>, context: ParsingContext): Expression | null | void {
            if (args.length !== 3 && args.length !== 4)
                return context.error(`Expected two or three arguments.`);

            const op = args[0] as ComparisonOperator;

            let lhs = context.parse(args[1], 1, ValueType);
            if (!lhs) return null;
            if (!isComparableType(op, lhs.type)) {
                return context.concat(1).error(`"${op}" comparisons are not supported for type '${toString(lhs.type)}'.`);
            }
            let rhs = context.parse(args[2], 2, ValueType);
            if (!rhs) return null;
            if (!isComparableType(op, rhs.type)) {
                return context.concat(2).error(`"${op}" comparisons are not supported for type '${toString(rhs.type)}'.`);
            }

            if (
                lhs.type.kind !== rhs.type.kind &&
                lhs.type.kind !== 'value' &&
                rhs.type.kind !== 'value'
            ) {
                return context.error(`Cannot compare types '${toString(lhs.type)}' and '${toString(rhs.type)}'.`);
            }

            if (isOrderComparison) {
                // typing rules specific to less/greater than operators
                if (lhs.type.kind === 'value' && rhs.type.kind !== 'value') {
                    // (value, T)
                    lhs = new Assertion(rhs.type, [lhs]);
                } else if (lhs.type.kind !== 'value' && rhs.type.kind === 'value') {
                    // (T, value)
                    rhs = new Assertion(lhs.type, [rhs]);
                }
            }

            let collator = null;
            if (args.length === 4) {
                if (
                    lhs.type.kind !== 'string' &&
                    rhs.type.kind !== 'string' &&
                    lhs.type.kind !== 'value' &&
                    rhs.type.kind !== 'value'
                ) {
                    return context.error(`Cannot use collator to compare non-string types.`);
                }
                collator = context.parse(args[3], 3, CollatorType);
                if (!collator) return null;
            }

            return new Comparison(lhs, rhs, collator);
        }

        evaluate(ctx: EvaluationContext): boolean {
            const lhs = this.lhs.evaluate(ctx);
            const rhs = this.rhs.evaluate(ctx);

            if (isOrderComparison && this.hasUntypedArgument) {
                const lt = typeOf(lhs);
                const rt = typeOf(rhs);
                // check that type is string or number, and equal
                if (lt.kind !== rt.kind || !(lt.kind === 'string' || lt.kind === 'number')) {
                    throw new RuntimeError(`Expected arguments for "${op}" to be (string, string) or (number, number), but found (${lt.kind}, ${rt.kind}) instead.`);
                }
            }

            if (this.collator && !isOrderComparison && this.hasUntypedArgument) {
                const lt = typeOf(lhs);
                const rt = typeOf(rhs);
                if (lt.kind !== 'string' || rt.kind !== 'string') {
                    return compareBasic(ctx, lhs, rhs);
                }
            }

            return this.collator ?
                compareWithCollator(ctx, lhs, rhs, this.collator.evaluate(ctx)) :
                compareBasic(ctx, lhs, rhs);
        }

        eachChild(fn: (_: Expression) => void) {
            fn(this.lhs);
            fn(this.rhs);
            if (this.collator) {
                fn(this.collator);
            }
        }

        outputDefined(): boolean {
            return true;
        }

        serialize(): SerializedExpression {
            const serialized: SerializedExpression[] = [op];
            this.eachChild(child => { serialized.push(child.serialize()); });
            return serialized;
        }
    };
}

export const Equals: ReturnType<typeof makeComparison> = makeComparison('==', eq, eqCollate);
export const NotEquals: ReturnType<typeof makeComparison> = makeComparison('!=', neq, neqCollate);
export const LessThan: ReturnType<typeof makeComparison> = makeComparison('<', lt, ltCollate);
export const GreaterThan: ReturnType<typeof makeComparison> = makeComparison('>', gt, gtCollate);
export const LessThanOrEqual: ReturnType<typeof makeComparison> = makeComparison('<=', lteq, lteqCollate);
export const GreaterThanOrEqual: ReturnType<typeof makeComparison> = makeComparison('>=', gteq, gteqCollate);
