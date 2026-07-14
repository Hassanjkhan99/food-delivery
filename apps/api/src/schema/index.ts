// Assemble the schema: importing each domain module registers its fields on the builder.
import { builder } from "./builder.js";
import "./auth.js";
import "./marketplace.js";
import "./order.js";
import "./payment.js";
import "./wallet.js";
import "./restaurant.js";
import "./media.js";
import "./rider.js";
import "./dispatch.js";
import "./admin.js";
import "./support.js";
import "./campaign.js";
import "./help.js";
import "./voucher.js";
import "./notification.js";
import "./referral.js";
import "./subscription.js";
import "./membership.js";
import "./giftCard.js";
import "./engagement.js";

export const schema = builder.toSchema();
