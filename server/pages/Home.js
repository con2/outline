// @flow
import * as React from "react";
import { Helmet } from "react-helmet";
import styled from "styled-components";
import Grid from "styled-components-grid";
import AuthNotices from "./components/AuthNotices";
import Hero from "./components/Hero";
import HeroText from "./components/HeroText";
import SigninButtons from "./components/SigninButtons";
import Branding from "../../shared/components/Branding";
import { githubUrl } from "../../shared/utils/routeHelpers";

type Props = {
  notice?: "google-hd" | "auth-error" | "hd-not-allowed",
  lastSignedIn: string,
  googleSigninEnabled: boolean,
  slackSigninEnabled: boolean,
  kompassiSigninEnabled: boolean,
  localSigninEnabled: boolean,
};

function Home(props: Props) {
  return (
    <span>
      <Helmet>
        <title>Con2 Outline</title>
      </Helmet>
      <Grid>
        <Hero id="signin">
          <AuthNotices notice={props.notice} />
          {process.env.TEAM_LOGO && <Logo src={process.env.TEAM_LOGO} />}
          <h1>Con2 Outline</h1>
          <HeroText>Tervetuloa Con2-projektin Outline-wikiin!</HeroText>
          <p>
            <SigninButtons {...props} />
          </p>
        </Hero>
      </Grid>
      <Branding href={githubUrl()} />
    </span>
  );
}

const Logo = styled.img`
  height: 60px;
  border-radius: 4px;
`;

export default Home;
