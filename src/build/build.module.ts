import { Module } from '@nestjs/common';
import { BuildValidatorService } from './build-validator.service';

@Module({
    providers: [BuildValidatorService],
    exports: [BuildValidatorService],
})
export class BuildModule { }
