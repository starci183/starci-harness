import { Entity } from "typeorm"

@Entity("user_score_projection")
/** The read-model row of one user's score. */
export class UserScoreProjectionEntity {
    userId!: string
    total!: number
}
