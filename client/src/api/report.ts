/** The `report` slice's routes: one trak's problem report, previewed and sent. */

import { Schema } from "effect"
import {
  ReportDto as ReportSchema,
  ReportSendAnswerDto as ReportSendAnswerSchema,
} from "@orkestra/shared/dto/report"
import { get, post, trakPath } from "./http"
import type { ReportDto, ReportSendAnswerDto, ReportSendRequestDto } from "./types"

const decodeReport = Schema.decodeUnknownSync(ReportSchema)
const decodeAnswer = Schema.decodeUnknownSync(ReportSendAnswerSchema)

/**
 * `GET /api/traks/:id/report`. Free. What a send would carry now, with the log and no
 * note. 404 where the host has no report destination.
 */
export const reportPreview = async (id: string): Promise<ReportDto> =>
  decodeReport(await get(`${trakPath(id)}/report`))

/**
 * `POST /api/traks/:id/report`. **Spends nothing and takes no custody**: the engine
 * rebuilds the report from the log and hands it to the host. A send the host could not
 * make is a 200 carrying its reason — the answer, not an error.
 */
export const sendReport = async (
  id: string,
  request: ReportSendRequestDto,
): Promise<ReportSendAnswerDto> => decodeAnswer(await post(`${trakPath(id)}/report`, request))
