import { Module } from '@nestjs/common';
import { PreviewController } from './preview.controller';
import { DevServerService } from './dev-server.service';

@Module({
    providers: [DevServerService],
    controllers: [PreviewController],
    exports: [DevServerService],
})
export class PreviewModule { }
