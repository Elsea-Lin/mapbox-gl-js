import {array, ValueType, NumberType} from '../types';
import RuntimeError from '../runtime_error';

import type {Expression, SerializedExpression} from '../expression';
import type ParsingContext from '../parsing_context';
import type EvaluationContext from '../evaluation_context';
import type {Type, ArrayType} from '../types';
import type {Value} from '../values';

class At implements Expression {
    type: Type;
    index: Expression;
    input: Expression;

    constructor(type: Type, index: Expression, input: Expression) {
        this.type = type;
        this.index = index;
        this.input = input;
    }

    static parse(args: ReadonlyArray<unknown>, context: ParsingContext): At | null | void {
        if (args.length !== 3)
            return context.error(`Expected 2 arguments, but found ${args.length - 1} instead.`);

        const index = context.parse(args[1], 1, NumberType);
        const input = context.parse(args[2], 2, array(context.expectedType || ValueType));

        if (!index || !input) return null;

        const t = input.type as ArrayType;
        return new At(t.itemType, index, input);
    }

    evaluate(ctx: EvaluationContext): Value {
        const index = (this.index.evaluate(ctx) as number);
        const array = (this.input.evaluate(ctx) as Array<Value>);

        if (index < 0) {
            throw new RuntimeError(`Array index out of bounds: ${index} < 0.`);
        }

        if (index >= array.length) {
            throw new RuntimeError(`Array index out of bounds: ${index} > ${array.length - 1}.`);
        }

        if (index !== Math.floor(index)) {
            throw new RuntimeError(`Array index must be an integer, but found ${index} instead. Use at-interpolated to retrieve interpolated result with a fractional index.`);
        }

        return array[index];
    }

    eachChild(fn: (_: Expression) => void) {
        fn(this.index);
        fn(this.input);
    }

    outputDefined(): boolean {
        return false;
    }

    serialize(): SerializedExpression {
        return ["at", this.index.serialize(), this.input.serialize()];
    }
}

export default At;
